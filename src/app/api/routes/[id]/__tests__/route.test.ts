import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    route: {
      findFirst: vi.fn(),
    },
  },
}));

import { GET } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

describe("GET /api/routes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createNextRequest = () => {
    return {
      headers: new Headers(),
    } as any;
  };

  it("returns 401 if unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);

    const req = createNextRequest();
    const res = await GET(req, { params: { id: "route-123" } });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 if route is not found or not owned by user", async () => {
    (auth as any).mockResolvedValue({
      user: { id: "user-123" },
    });
    (prisma.route.findFirst as any).mockResolvedValue(null);

    const req = createNextRequest();
    const res = await GET(req, { params: { id: "route-999" } });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(prisma.route.findFirst).toHaveBeenCalledWith({
      where: {
        id: "route-999",
        userId: "user-123",
      },
    });
  });

  it("returns 200 and formatted route when owned by user", async () => {
    (auth as any).mockResolvedValue({
      user: { id: "user-123" },
    });

    const mockRoute = {
      id: "route-123",
      userId: "user-123",
      originLat: 18.5204,
      originLng: 73.8567,
      destinationLat: 15.2993,
      destinationLng: 74.124,
      originName: "Pune",
      destinationName: "Goa",
      distance: 450000,
      duration: 28800,
      encodedPolyline: "xyz123",
      waypoints: JSON.stringify([{ location: { lat: 16.0, lng: 73.8 }, stopover: true }]),
      tripName: "Goa Road Trip",
      notes: "Pack sunscreen",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.route.findFirst as any).mockResolvedValue(mockRoute);

    const req = createNextRequest();
    const res = await GET(req, { params: { id: "route-123" } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("route-123");
    expect(body.origin).toEqual({ lat: 18.5204, lng: 73.8567 });
    expect(body.destination).toEqual({ lat: 15.2993, lng: 74.124 });
    expect(body.waypoints).toEqual([{ location: { lat: 16.0, lng: 73.8 }, stopover: true }]);
  });
});
