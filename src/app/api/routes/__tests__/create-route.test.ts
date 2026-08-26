import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { ROUTE_LIMITS } from "@/lib/validation/route-payload";
import { POST } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    route: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

const validPayload = {
  origin: { lat: 18.5204, lng: 73.8567 },
  destination: { lat: 15.2993, lng: 74.124 },
  distance: 450_000,
  duration: 32_400,
  encodedPolyline: "_p~iF~ps|U_ulLnnqC",
};

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function send(overrides: Record<string, unknown> = {}) {
  return POST(
    postRequest({ ...validPayload, ...overrides }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);

  vi.mocked(enforceRateLimit).mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetAt: 1_700_000_000,
    retryAfter: 0,
  } as never);

  vi.mocked(prisma.route.count).mockResolvedValue(
    0 as never,
  );
  vi.mocked(prisma.route.create).mockResolvedValue({
    id: "route-1",
  } as never);
  vi.mocked(prisma.route.update).mockResolvedValue({
    id: "route-1",
  } as never);
  vi.mocked(prisma.route.findFirst).mockResolvedValue({
    id: "route-1",
  } as never);
});

describe("POST /api/routes", () => {
  it("rejects an unauthenticated request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await send();

    expect(response.status).toBe(401);
    expect(prisma.route.create).not.toHaveBeenCalled();
  });

  it("creates a route from a valid payload", async () => {
    const response = await send();

    expect(response.status).toBe(201);
    expect(prisma.route.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          originLat: 18.5204,
          destinationLng: 74.124,
          distance: 450_000,
        }),
      }),
    );
  });

  it("updates an existing route the caller owns", async () => {
    const response = await send({ id: "route-1" });

    expect(response.status).toBe(200);
    expect(prisma.route.update).toHaveBeenCalled();
    expect(prisma.route.create).not.toHaveBeenCalled();
  });

  it("refuses to update a route belonging to somebody else", async () => {
    vi.mocked(prisma.route.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await send({ id: "route-1" });

    expect(response.status).toBe(404);
    expect(prisma.route.update).not.toHaveBeenCalled();
  });

  describe("payload bounds", () => {
    it("rejects an out-of-range latitude", async () => {
      const response = await send({
        origin: { lat: 900, lng: -4000 },
      });

      expect(response.status).toBe(400);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("rejects a negative distance", async () => {
      const response = await send({ distance: -1 });

      expect(response.status).toBe(400);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("rejects a non-finite distance rather than storing NaN", async () => {
      // JSON has no NaN literal; 1e400 parses to Infinity, which is exactly
      // how the bad value arrived in practice.
      const response = await POST(
        postRequest({
          ...validPayload,
          distance: 1e400,
        } as never),
      );

      expect(response.status).toBe(400);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("rejects an oversized encoded polyline", async () => {
      const response = await send({
        encodedPolyline: "a".repeat(
          ROUTE_LIMITS.encodedPolylineMax + 1,
        ),
      });

      expect(response.status).toBe(400);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("rejects more waypoints than the cap", async () => {
      const response = await send({
        waypoints: Array.from(
          { length: ROUTE_LIMITS.waypoints + 1 },
          () => ({
            location: { lat: 17, lng: 74 },
            stopover: true,
          }),
        ),
      });

      expect(response.status).toBe(400);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("rejects oversized notes", async () => {
      const response = await send({
        notes: "x".repeat(ROUTE_LIMITS.notesMax + 1),
      });

      expect(response.status).toBe(400);
    });

    it("accepts a waypoint without an explicit stopover flag", async () => {
      const response = await send({
        waypoints: [{ location: { lat: 17, lng: 74 } }],
      });

      expect(response.status).toBe(201);

      const data = vi.mocked(prisma.route.create).mock
        .calls[0][0].data as Record<string, unknown>;

      expect(
        JSON.parse(data.waypoints as string)[0].stopover,
      ).toBe(true);
    });
  });

  describe("per-user cap", () => {
    it("refuses to create past the ceiling", async () => {
      vi.mocked(prisma.route.count).mockResolvedValue(
        ROUTE_LIMITS.routesPerUser as never,
      );

      const response = await send();

      expect(response.status).toBe(409);
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("counts only the caller's own routes", async () => {
      await send();

      expect(prisma.route.count).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
    });

    it("still allows an update at the ceiling", async () => {
      vi.mocked(prisma.route.count).mockResolvedValue(
        ROUTE_LIMITS.routesPerUser as never,
      );

      const response = await send({ id: "route-1" });

      expect(response.status).toBe(200);
      expect(prisma.route.update).toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("throttles repeated writes", async () => {
      vi.mocked(enforceRateLimit).mockResolvedValue({
        allowed: false,
        limit: 30,
        remaining: 0,
        resetAt: 1_700_000_000,
        retryAfter: 12,
      } as never);

      const response = await send();

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("12");
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it("keys the limit on the signed-in user", async () => {
      await send();

      expect(enforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        "routeWrite",
        "user-1",
      );
    });

    it("exposes the remaining budget on success", async () => {
      const response = await send();

      expect(
        response.headers.get("X-RateLimit-Remaining"),
      ).toBe("29");
    });
  });

  it("returns 500 when the write fails", async () => {
    vi.mocked(prisma.route.create).mockRejectedValue(
      new Error("db down") as never,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send();

    expect(response.status).toBe(500);
  });
});
