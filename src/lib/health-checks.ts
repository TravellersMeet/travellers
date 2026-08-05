import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 1_500;
const MIN_HEALTH_CHECK_TIMEOUT_MS = 100;
const MAX_HEALTH_CHECK_TIMEOUT_MS = 10_000;

export type DependencyStatus = "up" | "down" | "skipped";

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
  required: boolean;
}

export interface ReadinessChecks {
  database: DependencyCheck;
  redis: DependencyCheck;
}

function parseTimeoutMs(
  value = process.env.HEALTH_CHECK_TIMEOUT_MS,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  }

  return Math.min(
    MAX_HEALTH_CHECK_TIMEOUT_MS,
    Math.max(
      MIN_HEALTH_CHECK_TIMEOUT_MS,
      Math.trunc(parsed),
    ),
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("Dependency check timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(
    0,
    Math.round(performance.now() - startedAt),
  );
}

export async function checkDatabase(
  timeoutMs = parseTimeoutMs(),
): Promise<DependencyCheck> {
  const startedAt = performance.now();

  try {
    await withTimeout(
      prisma.$queryRaw`SELECT 1`,
      timeoutMs,
    );

    return {
      status: "up",
      latencyMs: elapsedMilliseconds(startedAt),
      required: true,
    };
  } catch {
    return {
      status: "down",
      latencyMs: elapsedMilliseconds(startedAt),
      required: true,
    };
  }
}

export async function checkRedis(
  timeoutMs = parseTimeoutMs(),
): Promise<DependencyCheck> {
  const configured = Boolean(process.env.REDIS_URL);

  if (!configured) {
    return {
      status: "skipped",
      latencyMs: 0,
      required: false,
    };
  }

  const startedAt = performance.now();

  if (!redis) {
    return {
      status: "down",
      latencyMs: elapsedMilliseconds(startedAt),
      required: false,
    };
  }

  try {
    await withTimeout(redis.ping(), timeoutMs);

    return {
      status: "up",
      latencyMs: elapsedMilliseconds(startedAt),
      required: false,
    };
  } catch {
    return {
      status: "down",
      latencyMs: elapsedMilliseconds(startedAt),
      required: false,
    };
  }
}

export async function runReadinessChecks(): Promise<ReadinessChecks> {
  const [database, redisCheck] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  return {
    database,
    redis: redisCheck,
  };
}

export function getReadinessStatus(
  checks: ReadinessChecks,
): "ready" | "degraded" | "unavailable" {
  if (
    checks.database.required &&
    checks.database.status !== "up"
  ) {
    return "unavailable";
  }

  if (
    Object.values(checks).some(
      (check) => check.status === "down",
    )
  ) {
    return "degraded";
  }

  return "ready";
}
