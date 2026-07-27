import { createHash } from "node:crypto";

import redis from "@/lib/redis";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_SECONDS = 60;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export interface StoredIdempotencyResult<T> {
  status: number;
  body: T;
}

export type IdempotencyClaim =
  | {
      state: "disabled";
    }
  | {
      state: "replay";
      result: StoredIdempotencyResult<unknown>;
    }
  | {
      state: "acquired";
      storageKey: string;
      lockKey: string;
    }
  | {
      state: "in_progress";
    };

function hash(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export function validateIdempotencyKey(
  value: string | null,
): string | null {
  if (value === null || value === "") {
    return null;
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new Error(
      "Idempotency-Key must be 8-128 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.",
    );
  }

  return value;
}

function buildKeys(userId: string, key: string) {
  const digest = hash(`${userId}:${key}`);

  return {
    storageKey: `ticket-idempotency:result:${digest}`,
    lockKey: `ticket-idempotency:lock:${digest}`,
  };
}

export async function claimIdempotencyKey(
  userId: string,
  rawKey: string | null,
): Promise<IdempotencyClaim> {
  const key = validateIdempotencyKey(rawKey);

  if (!key || !redis) {
    return { state: "disabled" };
  }

  const { storageKey, lockKey } = buildKeys(userId, key);

  try {
    const existing = await redis.get(storageKey);

    if (existing) {
      return {
        state: "replay",
        result: JSON.parse(existing),
      };
    }

    const acquired = await redis.set(
      lockKey,
      "1",
      "EX",
      LOCK_TTL_SECONDS,
      "NX",
    );

    if (acquired !== "OK") {
      const replay = await redis.get(storageKey);

      if (replay) {
        return {
          state: "replay",
          result: JSON.parse(replay),
        };
      }

      return { state: "in_progress" };
    }

    return {
      state: "acquired",
      storageKey,
      lockKey,
    };
  } catch (error) {
    console.warn(
      "Idempotency store unavailable; continuing without it:",
      error instanceof Error ? error.message : error,
    );

    return { state: "disabled" };
  }
}

export async function storeIdempotencyResult<T>(
  claim: IdempotencyClaim,
  result: StoredIdempotencyResult<T>,
): Promise<void> {
  if (claim.state !== "acquired" || !redis) {
    return;
  }

  try {
    await redis
      .multi()
      .set(
        claim.storageKey,
        JSON.stringify(result),
        "EX",
        IDEMPOTENCY_TTL_SECONDS,
      )
      .del(claim.lockKey)
      .exec();
  } catch (error) {
    console.warn(
      "Unable to store idempotency result:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function releaseIdempotencyClaim(
  claim: IdempotencyClaim,
): Promise<void> {
  if (claim.state !== "acquired" || !redis) {
    return;
  }

  try {
    await redis.del(claim.lockKey);
  } catch (error) {
    console.warn(
      "Unable to release idempotency lock:",
      error instanceof Error ? error.message : error,
    );
  }
}
