import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  GET,
  HEATMAP_MAX_FEATURES,
  HEATMAP_TICKET_LIMIT,
} from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    ticket: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function heatmapRequest() {
  return new NextRequest(
    "http://localhost/api/matches/heatmap",
  );
}

function withTickets(destinations: string[]) {
  vi.mocked(prisma.ticket.findMany).mockResolvedValue(
    destinations.map((destination) => ({
      destination,
    })) as never,
  );
}

async function collection(
  destinations: string[],
): Promise<any> {
  withTickets(destinations);

  const response = await GET(heatmapRequest());

  expect(response.status).toBe(200);

  return response.json();
}

function featureFor(body: any, id: string) {
  return body.features.find(
    (feature: any) => feature.properties.id === id,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  withTickets([]);
});

describe("GET /api/matches/heatmap", () => {
  it("rejects an unauthenticated request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(heatmapRequest());

    expect(response.status).toBe(401);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty FeatureCollection when there are no tickets", async () => {
    const body = await collection([]);

    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toEqual([]);
    expect(body.meta.maxWeight).toBe(0);
  });

  describe("coordinates", () => {
    it("places a destination at its real coordinates", async () => {
      const body = await collection(["Tokyo"]);
      const tokyo = featureFor(body, "tokyo");

      // [lng, lat] per GeoJSON, and actually in Japan.
      expect(tokyo.geometry.coordinates[0]).toBeCloseTo(
        139.6503,
        2,
      );
      expect(tokyo.geometry.coordinates[1]).toBeCloseTo(
        35.6762,
        2,
      );
    });

    it("keeps destinations with the same name length apart", async () => {
      // The old length-based hash put these on the same point.
      const body = await collection(["Tokyo", "Delhi"]);

      const tokyo = featureFor(body, "tokyo");
      const delhi = featureFor(body, "delhi");

      expect(tokyo.geometry.coordinates).not.toEqual(
        delhi.geometry.coordinates,
      );
      expect(delhi.geometry.coordinates[0]).toBeGreaterThan(
        70,
      );
      expect(delhi.geometry.coordinates[0]).toBeLessThan(80);
    });

    it("emits coordinates within valid geographic bounds", async () => {
      const body = await collection([
        "Tokyo",
        "Sydney",
        "Rio de Janeiro",
        "Cape Town",
      ]);

      for (const feature of body.features) {
        const [lng, lat] = feature.geometry.coordinates;

        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    });

    it("does not depend on ticket ordering", async () => {
      const first = await collection([
        "Tokyo",
        "Paris",
        "Delhi",
      ]);
      const second = await collection([
        "Delhi",
        "Tokyo",
        "Paris",
      ]);

      const geometry = (body: any) =>
        body.features
          .map((feature: any) => [
            feature.properties.id,
            feature.geometry.coordinates,
          ])
          .sort();

      expect(geometry(first)).toEqual(geometry(second));
    });
  });

  describe("aggregation", () => {
    it("collapses repeats into one weighted feature", async () => {
      const body = await collection([
        "Tokyo",
        "tokyo",
        "Tokyo, Japan",
        "NRT",
      ]);

      expect(body.features).toHaveLength(1);
      expect(body.features[0].properties.weight).toBe(4);
    });

    it("weights each destination by its ticket count", async () => {
      const body = await collection([
        "Paris",
        "Paris",
        "Paris",
        "London",
      ]);

      expect(featureFor(body, "paris").properties.weight).toBe(
        3,
      );
      expect(
        featureFor(body, "london").properties.weight,
      ).toBe(1);
      expect(body.meta.maxWeight).toBe(3);
    });

    it("returns the busiest destination first", async () => {
      const body = await collection([
        "London",
        "Tokyo",
        "Tokyo",
      ]);

      expect(body.features[0].properties.id).toBe("tokyo");
    });

    it("labels each feature with the destination name", async () => {
      const body = await collection(["Tokyo"]);

      expect(body.features[0].properties).toMatchObject({
        id: "tokyo",
        city: "Tokyo",
        weight: 1,
      });
      expect(
        body.features[0].properties.country,
      ).toBeTruthy();
    });
  });

  describe("unresolved destinations", () => {
    it("excludes them from the map", async () => {
      const body = await collection([
        "Tokyo",
        "Atlantis",
        "El Dorado",
      ]);

      expect(body.features).toHaveLength(1);
      expect(body.features[0].properties.id).toBe("tokyo");
    });

    it("reports them in the metadata instead of hiding them", async () => {
      const body = await collection([
        "Tokyo",
        "Atlantis",
        "El Dorado",
      ]);

      expect(body.meta).toMatchObject({
        sampledTickets: 3,
        resolvedTickets: 1,
        unresolvedTickets: 2,
        unresolvedDestinations: 2,
      });
    });
  });

  describe("query bounds", () => {
    it("caps how many tickets are read", async () => {
      await collection(["Tokyo"]);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: HEATMAP_TICKET_LIMIT,
        }),
      );
    });

    it("only reads verified upcoming tickets", async () => {
      await collection(["Tokyo"]);

      const [args] = vi.mocked(prisma.ticket.findMany).mock
        .calls[0];
      const where = (args as any).where;

      expect(where.status).toBe("VERIFIED");
      expect(where.departureDate.gte).toBeInstanceOf(Date);
    });

    it("selects only the destination column", async () => {
      await collection(["Tokyo"]);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { destination: true },
        }),
      );
    });

    it("never returns more features than the cap", async () => {
      const body = await collection(
        Array.from({ length: 400 }, () => "Tokyo"),
      );

      expect(
        body.features.length,
      ).toBeLessThanOrEqual(HEATMAP_MAX_FEATURES);
    });
  });

  it("returns 500 when the query fails", async () => {
    vi.mocked(prisma.ticket.findMany).mockRejectedValue(
      new Error("db down") as never,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(heatmapRequest());

    expect(response.status).toBe(500);
  });
});
