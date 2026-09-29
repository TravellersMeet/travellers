import { beforeEach, describe, expect, it } from "vitest";

import { destinations } from "@/lib/data/destinations";
import {
  aggregateDestinations,
  resetDestinationIndex,
  resolveDestination,
} from "@/lib/geocode-destination";

beforeEach(() => {
  resetDestinationIndex();
});

function coordinatesFor(id: string) {
  const destination = destinations.find(
    (entry) => entry.id === id,
  );

  if (!destination) {
    throw new Error(`Fixture destination ${id} is missing`);
  }

  return destination.coordinates;
}

describe("resolveDestination", () => {
  it("resolves an exact city name", () => {
    const resolved = resolveDestination("Tokyo");

    expect(resolved?.destination.id).toBe("tokyo");
    expect(resolved?.destination.coordinates).toEqual(
      coordinatesFor("tokyo"),
    );
  });

  it("is case and whitespace insensitive", () => {
    for (const input of [
      "tokyo",
      "TOKYO",
      "  Tokyo  ",
      "Tokyo",
    ]) {
      expect(resolveDestination(input)?.destination.id).toBe(
        "tokyo",
      );
    }
  });

  it("collapses repeated internal whitespace", () => {
    expect(
      resolveDestination("New    York    City")?.destination
        .id,
    ).toBe("nyc");
  });

  it("resolves a declared alias", () => {
    expect(resolveDestination("NYC")?.destination.id).toBe(
      "nyc",
    );
    expect(
      resolveDestination("Manhattan")?.destination.id,
    ).toBe("nyc");
  });

  it("resolves an airport code", () => {
    expect(resolveDestination("JFK")?.destination.id).toBe(
      "nyc",
    );
    expect(resolveDestination("lax")?.destination.id).toBe(
      "lax",
    );
  });

  it("resolves a City, Country string", () => {
    expect(
      resolveDestination("Tokyo, Japan")?.destination.id,
    ).toBe("tokyo");
  });

  it("falls back to a segment when the whole string is unknown", () => {
    expect(
      resolveDestination("Shinjuku, Tokyo, Japan")
        ?.destination.id,
    ).toBe("tokyo");
  });

  it("prefers the most specific segment", () => {
    const resolved = resolveDestination(
      "Tokyo, Japan, Asia",
    );

    expect(resolved?.destination.id).toBe("tokyo");
  });

  it("returns null for a destination outside the gazetteer", () => {
    expect(resolveDestination("Atlantis")).toBeNull();
    expect(resolveDestination("Nowhere, Narnia")).toBeNull();
  });

  it("returns null for empty and non-string input", () => {
    expect(resolveDestination("")).toBeNull();
    expect(resolveDestination("   ")).toBeNull();
    expect(resolveDestination(null)).toBeNull();
    expect(resolveDestination(undefined)).toBeNull();
    expect(
      resolveDestination(42 as unknown as string),
    ).toBeNull();
  });

  it("does not match on a substring", () => {
    // "Osaka" must not be found inside an unrelated free-text destination.
    expect(
      resolveDestination("Somewhere near Osaka Bay"),
    ).toBeNull();
  });

  it("never invents a coordinate outside real bounds", () => {
    for (const destination of destinations) {
      const resolved = resolveDestination(destination.city);

      expect(resolved).not.toBeNull();
      expect(
        Math.abs(resolved!.destination.coordinates.lat),
      ).toBeLessThanOrEqual(90);
      expect(
        Math.abs(resolved!.destination.coordinates.lng),
      ).toBeLessThanOrEqual(180);
    }
  });

  it("distinguishes destinations that share a character count", () => {
    // The old implementation hashed on string length, so these collided.
    const tokyo = resolveDestination("Tokyo");
    const delhi = resolveDestination("Delhi");

    expect(tokyo?.destination.id).not.toBe(
      delhi?.destination.id,
    );
    expect(tokyo?.destination.coordinates).not.toEqual(
      delhi?.destination.coordinates,
    );
  });
});

describe("aggregateDestinations", () => {
  it("counts repeats into a single bucket", () => {
    const result = aggregateDestinations([
      "Tokyo",
      "tokyo",
      "Tokyo, Japan",
      "NRT",
    ]);

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].id).toBe("tokyo");
    expect(result.buckets[0].count).toBe(4);
    expect(result.resolvedCount).toBe(4);
  });

  it("returns buckets heaviest first", () => {
    const result = aggregateDestinations([
      "Paris",
      "Tokyo",
      "Tokyo",
      "Tokyo",
      "Paris",
      "London",
    ]);

    expect(
      result.buckets.map((bucket) => [
        bucket.id,
        bucket.count,
      ]),
    ).toEqual([
      ["tokyo", 3],
      ["paris", 2],
      ["london", 1],
    ]);
  });

  it("orders ties deterministically", () => {
    const first = aggregateDestinations(["Paris", "Tokyo"]);
    const second = aggregateDestinations(["Tokyo", "Paris"]);

    expect(first.buckets.map((b) => b.id)).toEqual(
      second.buckets.map((b) => b.id),
    );
  });

  it("reports unresolved destinations instead of placing them", () => {
    const result = aggregateDestinations([
      "Tokyo",
      "Atlantis",
      "atlantis ",
      "El Dorado",
    ]);

    expect(result.buckets).toHaveLength(1);
    expect(result.resolvedCount).toBe(1);
    expect(result.unresolvedCount).toBe(2);
    expect(result.unresolved).toEqual([
      "Atlantis",
      "El Dorado",
    ]);
  });

  it("ignores blank and null values entirely", () => {
    const result = aggregateDestinations([
      null,
      undefined,
      "",
      "   ",
    ]);

    expect(result.buckets).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolvedCount).toBe(0);
  });

  it("handles an empty input list", () => {
    const result = aggregateDestinations([]);

    expect(result).toEqual({
      buckets: [],
      unresolved: [],
      resolvedCount: 0,
      unresolvedCount: 0,
    });
  });

  it("carries real coordinates onto every bucket", () => {
    const result = aggregateDestinations([
      "Delhi",
      "Delhi",
    ]);

    expect(result.buckets[0].coordinates).toEqual(
      coordinatesFor("delhi"),
    );
    expect(result.buckets[0].country).toBeTruthy();
  });
});

describe("gazetteer integrity", () => {
  it("gives every destination a unique id", () => {
    const ids = destinations.map(
      (destination) => destination.id,
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every coordinate inside valid bounds", () => {
    for (const destination of destinations) {
      expect(
        destination.coordinates.lat,
      ).toBeGreaterThanOrEqual(-90);
      expect(
        destination.coordinates.lat,
      ).toBeLessThanOrEqual(90);
      expect(
        destination.coordinates.lng,
      ).toBeGreaterThanOrEqual(-180);
      expect(
        destination.coordinates.lng,
      ).toBeLessThanOrEqual(180);
    }
  });
});
