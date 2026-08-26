import { describe, expect, it } from "vitest";

import {
  coordinateSchema,
  latitudeSchema,
  longitudeSchema,
  ROUTE_LIMITS,
  routePayloadSchema,
  waypointSchema,
} from "@/lib/validation/route-payload";

const validPayload = {
  origin: { lat: 18.5204, lng: 73.8567 },
  destination: { lat: 15.2993, lng: 74.124 },
  distance: 450_000,
  duration: 32_400,
  encodedPolyline: "_p~iF~ps|U_ulLnnqC",
};

function parse(overrides: Record<string, unknown> = {}) {
  return routePayloadSchema.safeParse({
    ...validPayload,
    ...overrides,
  });
}

describe("coordinate validation", () => {
  it("accepts coordinates inside the valid range", () => {
    expect(
      coordinateSchema.safeParse({ lat: 18.52, lng: 73.85 })
        .success,
    ).toBe(true);
  });

  it("accepts the exact boundaries", () => {
    for (const lat of [-90, 90]) {
      expect(latitudeSchema.safeParse(lat).success).toBe(
        true,
      );
    }

    for (const lng of [-180, 180]) {
      expect(longitudeSchema.safeParse(lng).success).toBe(
        true,
      );
    }
  });

  it("rejects a latitude outside -90..90", () => {
    expect(latitudeSchema.safeParse(900).success).toBe(false);
    expect(latitudeSchema.safeParse(-90.1).success).toBe(
      false,
    );
  });

  it("rejects a longitude outside -180..180", () => {
    expect(longitudeSchema.safeParse(4000).success).toBe(
      false,
    );
    expect(longitudeSchema.safeParse(-180.5).success).toBe(
      false,
    );
  });

  it("rejects NaN and Infinity", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(latitudeSchema.safeParse(value).success).toBe(
        false,
      );
      expect(longitudeSchema.safeParse(value).success).toBe(
        false,
      );
    }
  });

  it("rejects numeric strings rather than coercing them", () => {
    expect(latitudeSchema.safeParse("18.52").success).toBe(
      false,
    );
  });
});

describe("routePayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(parse().success).toBe(true);
  });

  describe("coordinates", () => {
    it("rejects an out-of-range origin", () => {
      expect(
        parse({ origin: { lat: 900, lng: -4000 } }).success,
      ).toBe(false);
    });

    it("rejects an out-of-range destination", () => {
      expect(
        parse({ destination: { lat: -900, lng: 4000 } })
          .success,
      ).toBe(false);
    });

    it("requires both halves of a coordinate", () => {
      expect(parse({ origin: { lat: 18.52 } }).success).toBe(
        false,
      );
    });
  });

  describe("distance and duration", () => {
    it("rejects a negative distance", () => {
      expect(parse({ distance: -1 }).success).toBe(false);
    });

    it("rejects a negative duration", () => {
      expect(parse({ duration: -1 }).success).toBe(false);
    });

    it("accepts zero", () => {
      expect(
        parse({ distance: 0, duration: 0 }).success,
      ).toBe(true);
    });

    it("rejects NaN, which used to round-trip as null", () => {
      expect(parse({ distance: Number.NaN }).success).toBe(
        false,
      );
    });

    it("rejects Infinity", () => {
      expect(
        parse({ distance: Number.POSITIVE_INFINITY })
          .success,
      ).toBe(false);
      expect(parse({ duration: 1e400 }).success).toBe(false);
    });

    it("rejects an implausibly large distance", () => {
      expect(
        parse({ distance: ROUTE_LIMITS.distanceMax + 1 })
          .success,
      ).toBe(false);
    });

    it("rejects an implausibly long duration", () => {
      expect(
        parse({ duration: ROUTE_LIMITS.durationMax + 1 })
          .success,
      ).toBe(false);
    });
  });

  describe("encodedPolyline", () => {
    it("rejects an empty polyline", () => {
      expect(parse({ encodedPolyline: "" }).success).toBe(
        false,
      );
    });

    it("rejects a polyline past the size ceiling", () => {
      expect(
        parse({
          encodedPolyline: "a".repeat(
            ROUTE_LIMITS.encodedPolylineMax + 1,
          ),
        }).success,
      ).toBe(false);
    });

    it("accepts a polyline at the ceiling", () => {
      expect(
        parse({
          encodedPolyline: "a".repeat(
            ROUTE_LIMITS.encodedPolylineMax,
          ),
        }).success,
      ).toBe(true);
    });
  });

  describe("waypoints", () => {
    const waypoint = {
      location: { lat: 17.0, lng: 74.0 },
      stopover: true,
      name: "Kolhapur",
    };

    it("accepts a bounded list", () => {
      expect(parse({ waypoints: [waypoint] }).success).toBe(
        true,
      );
    });

    it("defaults stopover to true when the client omits it", () => {
      const result = waypointSchema.safeParse({
        location: { lat: 17.0, lng: 74.0 },
      });

      expect(result.success).toBe(true);
      expect(result.success && result.data.stopover).toBe(
        true,
      );
    });

    it("rejects more waypoints than the cap", () => {
      expect(
        parse({
          waypoints: Array.from(
            { length: ROUTE_LIMITS.waypoints + 1 },
            () => waypoint,
          ),
        }).success,
      ).toBe(false);
    });

    it("validates the coordinates of every waypoint", () => {
      expect(
        parse({
          waypoints: [
            waypoint,
            { location: { lat: 900, lng: 0 } },
          ],
        }).success,
      ).toBe(false);
    });

    it("rejects an oversized waypoint name", () => {
      expect(
        parse({
          waypoints: [
            {
              ...waypoint,
              name: "x".repeat(
                ROUTE_LIMITS.waypointNameMax + 1,
              ),
            },
          ],
        }).success,
      ).toBe(false);
    });
  });

  describe("text fields", () => {
    it("rejects an oversized trip name", () => {
      expect(
        parse({
          tripName: "x".repeat(
            ROUTE_LIMITS.tripNameMax + 1,
          ),
        }).success,
      ).toBe(false);
    });

    it("rejects oversized notes", () => {
      expect(
        parse({ notes: "x".repeat(ROUTE_LIMITS.notesMax + 1) })
          .success,
      ).toBe(false);
    });

    it("rejects an oversized place name", () => {
      expect(
        parse({
          originName: "x".repeat(
            ROUTE_LIMITS.placeNameMax + 1,
          ),
        }).success,
      ).toBe(false);
    });

    it("accepts them at exactly the maximum", () => {
      expect(
        parse({
          tripName: "x".repeat(ROUTE_LIMITS.tripNameMax),
          notes: "x".repeat(ROUTE_LIMITS.notesMax),
        }).success,
      ).toBe(true);
    });
  });

  it("rejects an empty id on an update", () => {
    expect(parse({ id: "" }).success).toBe(false);
  });

  it("reports the offending field so the client can point at it", () => {
    const result = parse({ origin: { lat: 900, lng: 0 } });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(
        result.error.issues[0].path.join("."),
      ).toBe("origin.lat");
    }
  });
});
