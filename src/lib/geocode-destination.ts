import {
  destinations,
  type Destination,
} from "@/lib/data/destinations";
import { normalizeDestination } from "@/lib/normalize-destination";

/**
 * Resolves the free-text `Ticket.destination` string to a real coordinate
 * using the bundled destinations gazetteer.
 *
 * Ticket destinations are typed by hand, so the same city arrives as "Tokyo",
 * "tokyo ", "Tokyo, Japan" and "NRT". Matching is therefore done against a
 * pre-built index of every name, city, alias and airport code rather than by
 * scanning the list per lookup.
 *
 * Nothing here guesses. A destination that is not in the gazetteer resolves to
 * `null` and the caller is expected to report it as unresolved — putting an
 * unknown city at an approximate coordinate is what made the heatmap
 * meaningless in the first place.
 */

export interface ResolvedDestination {
  destination: Destination;
  /** Which index key produced the hit. Useful when debugging bad matches. */
  matchedOn: string;
}

export interface DestinationBucket {
  id: string;
  name: string;
  city: string;
  country: string;
  region: string;
  coordinates: { lat: number; lng: number };
  /** Number of source rows that resolved to this destination. */
  count: number;
}

export interface DestinationAggregate {
  buckets: DestinationBucket[];
  /** Distinct raw values that no gazetteer entry matched. */
  unresolved: string[];
  resolvedCount: number;
  unresolvedCount: number;
}

/** IATA codes are exactly three letters, which keeps the check cheap. */
const IATA_PATTERN = /^[a-z]{3}$/;

interface DestinationIndex {
  byKey: Map<string, Destination>;
  /** Keys claimed by more than one destination, deliberately not resolvable. */
  ambiguous: Set<string>;
}

let cachedIndex: DestinationIndex | null = null;

function addKey(
  index: DestinationIndex,
  rawKey: string | undefined,
  destination: Destination,
): void {
  if (!rawKey) {
    return;
  }

  const key = normalizeDestination(rawKey);

  if (!key || index.ambiguous.has(key)) {
    return;
  }

  const existing = index.byKey.get(key);

  if (!existing) {
    index.byKey.set(key, destination);
    return;
  }

  if (existing.id === destination.id) {
    return;
  }

  // Two different cities answer to this string. Guessing between them would
  // silently attribute tickets to the wrong hotspot, so drop the key.
  index.byKey.delete(key);
  index.ambiguous.add(key);
}

function buildIndex(): DestinationIndex {
  const index: DestinationIndex = {
    byKey: new Map(),
    ambiguous: new Set(),
  };

  for (const destination of destinations) {
    addKey(index, destination.id, destination);
    addKey(index, destination.name, destination);
    addKey(index, destination.city, destination);
    addKey(
      index,
      `${destination.city}, ${destination.country}`,
      destination,
    );
    addKey(index, destination.airport, destination);

    for (const alias of destination.aliases ?? []) {
      addKey(index, alias, destination);
    }
  }

  return index;
}

function getIndex(): DestinationIndex {
  cachedIndex ??= buildIndex();
  return cachedIndex;
}

/** Test-only hook: forces the index to be rebuilt on the next lookup. */
export function resetDestinationIndex(): void {
  cachedIndex = null;
}

/**
 * Candidate keys to try, in decreasing order of specificity.
 *
 * "Tokyo, Japan" is tried whole first so a "City, Country" entry wins over a
 * bare city name, then each comma-separated segment is tried on its own. That
 * handles both "Tokyo, Japan" and the "Shinjuku, Tokyo, Japan" shape without
 * resorting to substring matching, which would let "Osaka" match inside an
 * unrelated string.
 */
function candidateKeys(raw: string): string[] {
  const normalized = normalizeDestination(raw);

  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  const segments = normalized
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length > 1) {
    // Longest prefix first: "shinjuku, tokyo, japan" -> "shinjuku, tokyo".
    for (let end = segments.length - 1; end >= 1; end -= 1) {
      candidates.push(segments.slice(0, end).join(", "));
    }

    // Then each segment alone, most specific first.
    candidates.push(...segments);
  }

  // A bare airport code is common on ticket uploads.
  const compact = normalized.replace(/[^a-z]/g, "");

  if (IATA_PATTERN.test(compact)) {
    candidates.push(compact);
  }

  return Array.from(new Set(candidates));
}

/**
 * Resolves one raw destination string, or `null` when the gazetteer has no
 * unambiguous entry for it.
 */
export function resolveDestination(
  raw: string | null | undefined,
): ResolvedDestination | null {
  if (typeof raw !== "string") {
    return null;
  }

  const index = getIndex();

  for (const key of candidateKeys(raw)) {
    const destination = index.byKey.get(key);

    if (destination) {
      return { destination, matchedOn: key };
    }
  }

  return null;
}

/**
 * Groups raw destination strings into one bucket per real place, counting how
 * many rows landed in each. Buckets come back heaviest first so a caller that
 * needs to cap the response keeps the busiest hotspots.
 */
export function aggregateDestinations(
  rawValues: Array<string | null | undefined>,
): DestinationAggregate {
  const buckets = new Map<string, DestinationBucket>();
  const unresolved = new Map<string, string>();
  let resolvedCount = 0;

  for (const raw of rawValues) {
    const resolved = resolveDestination(raw);

    if (!resolved) {
      const label =
        typeof raw === "string" ? raw.trim() : "";

      if (label) {
        // Keyed on the normalized form so "goa" and "Goa " are reported once.
        // The first spelling seen is kept, so the reported label stays stable
        // instead of changing with row ordering.
        const key = normalizeDestination(label);

        if (!unresolved.has(key)) {
          unresolved.set(key, label);
        }
      }

      continue;
    }

    resolvedCount += 1;

    const { destination } = resolved;
    const existing = buckets.get(destination.id);

    if (existing) {
      existing.count += 1;
      continue;
    }

    buckets.set(destination.id, {
      id: destination.id,
      name: destination.name,
      city: destination.city,
      country: destination.country,
      region: destination.region,
      coordinates: { ...destination.coordinates },
      count: 1,
    });
  }

  const sorted = Array.from(buckets.values()).sort(
    (a, b) =>
      b.count - a.count || a.id.localeCompare(b.id),
  );

  return {
    buckets: sorted,
    unresolved: Array.from(unresolved.values()).sort((a, b) =>
      a.localeCompare(b),
    ),
    resolvedCount,
    unresolvedCount: unresolved.size,
  };
}
