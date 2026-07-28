import { createHash } from "node:crypto";
import type Redis from "ioredis";

import redis from "@/lib/redis";

const MATCH_CACHE_TTL_SECONDS = 5 * 60;
const DEFAULT_WINDOW_DAYS = 3;

export interface MatchCacheFilters {
  gender?: string | null;
  tripPurpose?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface MatchCacheKeyInput {
  destination: string;
  date: string;
  userId: string;
  filters?: MatchCacheFilters;
}

export interface TicketCacheIdentity {
  destination: string;
  departureDate: Date | string;
}

export interface MatchCacheStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string | number,
    mode?: string,
    duration?: number,
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export function normalizeMatchDestination(
  destination: string,
): string {
  return destination
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function normalizeMatchDate(
  value: Date | string,
): string {
  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Match cache date is invalid.");
  }

  return date.toISOString().slice(0, 10);
}

function versionKey(
  destination: string,
  date: string,
): string {
  return `matches-version:${normalizeMatchDestination(
    destination,
  )}:${normalizeMatchDate(date)}`;
}

function filterFingerprint(
  filters: MatchCacheFilters = {},
): string {
  const canonical = JSON.stringify({
    gender: filters.gender ?? null,
    tripPurpose: filters.tripPurpose ?? null,
    ageMin: filters.ageMin ?? null,
    ageMax: filters.ageMax ?? null,
    startDate: filters.startDate
      ? normalizeMatchDate(filters.startDate)
      : null,
    endDate: filters.endDate
      ? normalizeMatchDate(filters.endDate)
      : null,
  });

  return createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

export async function getMatchCacheVersion(
  destination: string,
  date: string,
  store: MatchCacheStore | null = redis as unknown as MatchCacheStore | null,
): Promise<number> {
  if (!store) {
    return 0;
  }

  try {
    const raw = await store.get(
      versionKey(destination, date),
    );
    const parsed = Number(raw);

    return Number.isSafeInteger(parsed) && parsed >= 0
      ? parsed
      : 0;
  } catch (error) {
    console.warn(
      "Match-cache version unavailable:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

export async function buildMatchCacheKey(
  input: MatchCacheKeyInput,
  store: MatchCacheStore | null = redis as unknown as MatchCacheStore | null,
): Promise<string> {
  const destination =
    normalizeMatchDestination(input.destination);
  const date = normalizeMatchDate(input.date);
  const version = await getMatchCacheVersion(
    destination,
    date,
    store,
  );

  return [
    "matches",
    destination,
    date,
    input.userId,
    filterFingerprint(input.filters),
    `v${version}`,
  ].join(":");
}

export async function readMatchCache<T>(
  key: string,
  store: MatchCacheStore | null = redis as unknown as MatchCacheStore | null,
): Promise<T | null> {
  if (!store) {
    return null;
  }

  try {
    const cached = await store.get(key);
    return cached ? (JSON.parse(cached) as T) : null;
  } catch (error) {
    console.warn(
      "Match cache unavailable; skipping read:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export async function writeMatchCache<T>(
  key: string,
  value: T,
  store: MatchCacheStore | null = redis as unknown as MatchCacheStore | null,
): Promise<void> {
  if (!store) {
    return;
  }

  try {
    await store.set(
      key,
      JSON.stringify(value),
      "EX",
      MATCH_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    console.warn(
      "Match cache unavailable; skipping write:",
      error instanceof Error ? error.message : error,
    );
  }
}

function addUtcDays(
  date: Date,
  days: number,
): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getAffectedMatchDates(
  departureDate: Date | string,
  windowDays = DEFAULT_WINDOW_DAYS,
): string[] {
  const normalized = normalizeMatchDate(departureDate);
  const center = new Date(
    `${normalized}T00:00:00.000Z`,
  );
  const dates: string[] = [];

  for (
    let offset = -windowDays;
    offset <= windowDays;
    offset += 1
  ) {
    dates.push(
      normalizeMatchDate(addUtcDays(center, offset)),
    );
  }

  return dates;
}

async function incrementVersion(
  destination: string,
  date: string,
  store: MatchCacheStore,
): Promise<void> {
  const key = versionKey(destination, date);
  await store.incr(key);

  // Prevent permanent accumulation of version keys while retaining a
  // generous fallback period for old cache entries to expire.
  await store.expire(key, 30 * 24 * 60 * 60);
}

export async function invalidateMatchCachesForTicket(
  current: TicketCacheIdentity,
  previous?: TicketCacheIdentity | null,
  store: MatchCacheStore | null = redis as unknown as MatchCacheStore | null,
): Promise<void> {
  if (!store) {
    return;
  }

  const identities = [previous, current].filter(
    (value): value is TicketCacheIdentity =>
      Boolean(value),
  );
  const keys = new Set<string>();

  for (const identity of identities) {
    const destination =
      normalizeMatchDestination(
        identity.destination,
      );

    for (const date of getAffectedMatchDates(
      identity.departureDate,
    )) {
      keys.add(`${destination}\u0000${date}`);
    }
  }

  try {
    await Promise.all(
      [...keys].map((entry) => {
        const [destination, date] =
          entry.split("\u0000");
        return incrementVersion(
          destination,
          date,
          store,
        );
      }),
    );
  } catch (error) {
    console.warn(
      "Match-cache invalidation failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

export const MATCH_CACHE_TTL =
  MATCH_CACHE_TTL_SECONDS;
