import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import {
  encodeCursor,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { GET } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    route: {
      findMany: vi.fn(),
    },
  },
}));

describe("GET /api/routes pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as never);
  });

  it("returns a first page and pagination metadata", async () => {
    vi.mocked(prisma.route.findMany).mockResolvedValue(
      [
        {
          id: "route-3",
          updatedAt: new Date(
            "2026-07-22T12:00:00.000Z",
          ),
        },
        {
          id: "route-2",
          updatedAt: new Date(
            "2026-07-22T11:00:00.000Z",
          ),
        },
        {
          id: "route-1",
          updatedAt: new Date(
            "2026-07-22T10:00:00.000Z",
          ),
        },
      ] as never,
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/routes?limit=2",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.routes).toEqual(body.items);
    expect(prisma.route.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [
          { updatedAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });

  it("applies a following-page cursor without a cursor-row lookup", async () => {
    vi.mocked(prisma.route.findMany).mockResolvedValue(
      [] as never,
    );

    const cursor = encodeCursor({
      id: "deleted-route",
      timestamp: "2026-07-22T11:00:00.000Z",
    });

    await GET(
      new NextRequest(
        `http://localhost/api/routes?limit=2&cursor=${cursor}`,
      ),
    );

    expect(prisma.route.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          OR: expect.any(Array),
        }),
      }),
    );
    expect(
      (prisma.route as unknown as {
        findUnique?: unknown;
      }).findUnique,
    ).toBeUndefined();
  });

  it("returns 400 for an invalid cursor", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/routes?cursor=invalid",
      ),
    );

    expect(response.status).toBe(400);
    expect(prisma.route.findMany).not.toHaveBeenCalled();
  });
});
