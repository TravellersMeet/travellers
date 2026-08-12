import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  checkDatabase,
  checkRedis,
  getReadinessStatus,
} from "@/lib/health-checks";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  default: {
    ping: vi.fn(),
  },
}));

describe("health checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
  });

  it("reports the database as available", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      [{ "?column?": 1 }] as never,
    );

    await expect(checkDatabase()).resolves.toMatchObject({
      status: "up",
      required: true,
    });
  });

  it("reports database failures without exposing errors", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(
      new Error(
        "postgresql://secret-user:secret-password@host/database",
      ),
    );

    await expect(checkDatabase()).resolves.toMatchObject({
      status: "down",
      required: true,
    });
  });

  it("skips Redis when it is not configured", async () => {
    await expect(checkRedis()).resolves.toEqual({
      status: "skipped",
      latencyMs: 0,
      required: false,
    });

    expect(redis?.ping).not.toHaveBeenCalled();
  });

  it("checks Redis when it is configured", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.mocked(redis!.ping).mockResolvedValue("PONG");

    await expect(checkRedis()).resolves.toMatchObject({
      status: "up",
      required: false,
    });
  });

  it("returns unavailable only for required failures", () => {
    expect(
      getReadinessStatus({
        database: {
          status: "down",
          latencyMs: 1,
          required: true,
        },
        redis: {
          status: "up",
          latencyMs: 1,
          required: false,
        },
      }),
    ).toBe("unavailable");

    expect(
      getReadinessStatus({
        database: {
          status: "up",
          latencyMs: 1,
          required: true,
        },
        redis: {
          status: "down",
          latencyMs: 1,
          required: false,
        },
      }),
    ).toBe("degraded");
  });
});
