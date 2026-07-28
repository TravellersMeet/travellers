import {
  buildMatchCacheKey,
  getAffectedMatchDates,
  getMatchCacheVersion,
  invalidateMatchCachesForTicket,
  MATCH_CACHE_TTL,
  normalizeMatchDestination,
  readMatchCache,
  writeMatchCache,
  type MatchCacheStore,
} from "@/lib/match-cache";
import { describe, expect, it, vi } from "vitest";

class MemoryStore implements MatchCacheStore {
  readonly values = new Map<string, string>();
  readonly expirations = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string | number,
    mode?: string,
    duration?: number,
  ): Promise<"OK"> {
    this.values.set(key, String(value));
    if (mode === "EX" && duration) {
      this.expirations.set(key, duration);
    }
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const next =
      Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(
    key: string,
    seconds: number,
  ): Promise<number> {
    this.expirations.set(key, seconds);
    return 1;
  }
}

describe("match-cache keys", () => {
  it("normalizes destination values consistently", () => {
    expect(
      normalizeMatchDestination("  NEW   Delhi "),
    ).toBe("new delhi");
  });

  it("creates the same key for equivalent destinations", async () => {
    const store = new MemoryStore();

    const first = await buildMatchCacheKey(
      {
        destination: "New Delhi",
        date: "2026-08-15",
        userId: "user-1",
      },
      store,
    );
    const second = await buildMatchCacheKey(
      {
        destination: " new   DELHI ",
        date: "2026-08-15",
        userId: "user-1",
      },
      store,
    );

    expect(first).toBe(second);
  });

  it("separates advanced filter combinations", async () => {
    const store = new MemoryStore();

    const first = await buildMatchCacheKey(
      {
        destination: "Goa",
        date: "2026-08-15",
        userId: "user-1",
        filters: { gender: "Female" },
      },
      store,
    );
    const second = await buildMatchCacheKey(
      {
        destination: "Goa",
        date: "2026-08-15",
        userId: "user-1",
        filters: { gender: "Male" },
      },
      store,
    );

    expect(first).not.toBe(second);
  });
});

describe("cache reads and writes", () => {
  it("supports cache miss and cache hit", async () => {
    const store = new MemoryStore();
    const key = "matches:test";

    await expect(
      readMatchCache(key, store),
    ).resolves.toBeNull();

    await writeMatchCache(
      key,
      [{ userId: "user-2" }],
      store,
    );

    await expect(
      readMatchCache(key, store),
    ).resolves.toEqual([
      { userId: "user-2" },
    ]);
    expect(store.expirations.get(key)).toBe(
      MATCH_CACHE_TTL,
    );
  });
});

describe("cache invalidation", () => {
  it("invalidates the seven default search dates around a ticket", async () => {
    const store = new MemoryStore();

    await invalidateMatchCachesForTicket(
      {
        destination: "Goa",
        departureDate: "2026-08-15",
      },
      null,
      store,
    );

    expect(
      getAffectedMatchDates("2026-08-15"),
    ).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ]);

    for (const date of getAffectedMatchDates(
      "2026-08-15",
    )) {
      await expect(
        getMatchCacheVersion(
          "goa",
          date,
          store,
        ),
      ).resolves.toBe(1);
    }
  });

  it("changes cache keys after approval or rejection invalidation", async () => {
    const store = new MemoryStore();
    const input = {
      destination: "Goa",
      date: "2026-08-15",
      userId: "search-user",
    };

    const before = await buildMatchCacheKey(
      input,
      store,
    );

    await invalidateMatchCachesForTicket(
      {
        destination: "Goa",
        departureDate: "2026-08-15",
      },
      null,
      store,
    );

    const after = await buildMatchCacheKey(
      input,
      store,
    );

    expect(before).toContain(":v0");
    expect(after).toContain(":v1");
    expect(after).not.toBe(before);
  });

  it("invalidates old and new windows after destination or date changes", async () => {
    const store = new MemoryStore();

    await invalidateMatchCachesForTicket(
      {
        destination: "Mumbai",
        departureDate: "2026-09-10",
      },
      {
        destination: "Goa",
        departureDate: "2026-08-15",
      },
      store,
    );

    await expect(
      getMatchCacheVersion(
        "Goa",
        "2026-08-15",
        store,
      ),
    ).resolves.toBe(1);
    await expect(
      getMatchCacheVersion(
        "Mumbai",
        "2026-09-10",
        store,
      ),
    ).resolves.toBe(1);
  });

  it("fails safely when Redis is unavailable", async () => {
    const broken: MatchCacheStore = {
      get: vi
        .fn()
        .mockRejectedValue(
          new Error("Redis unavailable"),
        ),
      set: vi
        .fn()
        .mockRejectedValue(
          new Error("Redis unavailable"),
        ),
      incr: vi
        .fn()
        .mockRejectedValue(
          new Error("Redis unavailable"),
        ),
      expire: vi
        .fn()
        .mockRejectedValue(
          new Error("Redis unavailable"),
        ),
    };
    const warn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      getMatchCacheVersion(
        "Goa",
        "2026-08-15",
        broken,
      ),
    ).resolves.toBe(0);
    await expect(
      invalidateMatchCachesForTicket(
        {
          destination: "Goa",
          departureDate: "2026-08-15",
        },
        null,
        broken,
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
