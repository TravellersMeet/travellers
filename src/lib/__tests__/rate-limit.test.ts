import {
  applyRateLimitHeaders,
  buildRateLimitKey,
  checkRateLimit,
  rateLimitExceededResponse,
  type RateLimitStore,
} from "@/lib/rate-limit";
import { describe, expect, it, vi } from "vitest";

class MemoryRateLimitStore implements RateLimitStore {
  private readonly counts = new Map<string, number>();

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string,
    windowSeconds: number,
  ): Promise<[number, number]> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return [count, windowSeconds];
  }
}

describe("checkRateLimit", () => {
  it("allows requests under the configured limit", async () => {
    const store = new MemoryRateLimitStore();

    const result = await checkRateLimit({
      namespace: "auth:test",
      identifier: "user@example.com|203.0.113.5",
      limit: 3,
      windowSeconds: 60,
      store,
      now: () => 1_000_000,
    });

    expect(result).toMatchObject({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAt: 1060,
      retryAfter: 0,
      bypassed: false,
    });
  });

  it("blocks requests above the limit", async () => {
    const store = new MemoryRateLimitStore();
    const options = {
      namespace: "auth:test",
      identifier: "user@example.com|203.0.113.5",
      limit: 2,
      windowSeconds: 90,
      store,
      now: () => 2_000_000,
    };

    await checkRateLimit(options);
    await checkRateLimit(options);
    const blocked = await checkRateLimit(options);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBe(90);
  });

  it("keeps different identities in separate buckets", async () => {
    const store = new MemoryRateLimitStore();

    const first = await checkRateLimit({
      namespace: "auth:test",
      identifier: "first@example.com|203.0.113.5",
      limit: 1,
      windowSeconds: 60,
      store,
    });
    const second = await checkRateLimit({
      namespace: "auth:test",
      identifier: "second@example.com|203.0.113.5",
      limit: 1,
      windowSeconds: 60,
      store,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it("fails open when Redis is unavailable", async () => {
    const store: RateLimitStore = {
      eval: vi.fn().mockRejectedValue(new Error("Redis offline")),
    };

    const result = await checkRateLimit({
      namespace: "auth:test",
      identifier: "user@example.com",
      limit: 3,
      windowSeconds: 60,
      store,
    });

    expect(result.allowed).toBe(true);
    expect(result.bypassed).toBe(true);
  });

  it("does not expose raw identifiers in Redis keys", () => {
    const key = buildRateLimitKey(
      "auth:signin",
      "Secret.User@example.com|203.0.113.5",
    );

    expect(key).toMatch(/^rate-limit:auth:signin:[a-f0-9]{32}$/);
    expect(key).not.toContain("Secret.User");
    expect(key).not.toContain("203.0.113.5");
  });
});

describe("rate-limit responses", () => {
  const result = {
    allowed: false,
    limit: 3,
    remaining: 0,
    resetAt: 1234,
    retryAfter: 42,
    bypassed: false,
  };

  it("adds standard headers", () => {
    const response = applyRateLimitHeaders(
      new Response(null, { status: 204 }),
      result,
    );

    expect(response.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1234");
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("returns a 429 response with retry information", async () => {
    const response = rateLimitExceededResponse(result);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests",
      retryAfter: 42,
    });
  });
});
