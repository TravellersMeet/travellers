import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { DELETE, GET, PATCH } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/notifications${query}`,
  );
}

function notificationRow(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    userId: "user-1",
    type: "MESSAGE",
    title: `Notification ${id}`,
    content: "body",
    link: null,
    read: false,
    dedupeKey: null,
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.notification.findMany).mockResolvedValue(
      [] as never,
    );
    vi.mocked(prisma.notification.count).mockResolvedValue(
      0 as never,
    );
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("bounds the query instead of fetching every row", async () => {
    await GET(request());

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default page of 20, plus the lookahead row used to decide hasMore.
        take: 21,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("caps the page size at 100", async () => {
    await GET(request("?limit=500"));

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it("excludes notifications whose expiry has passed", async () => {
    await GET(request());

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    const expiryClause = where.AND.find(
      (clause: any) => clause.OR,
    );

    expect(expiryClause.OR[0]).toEqual({ expiresAt: null });
    expect(expiryClause.OR[1].expiresAt.gt).toBeInstanceOf(Date);
  });

  it("applies the same expiry rule to the unread badge", async () => {
    await GET(request());

    const [{ where }] = vi.mocked(prisma.notification.count).mock
      .calls[0] as [{ where: any }];

    expect(where.read).toBe(false);
    expect(where.OR[0]).toEqual({ expiresAt: null });
  });

  it("uses one clock reading for the page and the badge", async () => {
    await GET(request());

    const [{ where: listWhere }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];
    const [{ where: countWhere }] = vi.mocked(
      prisma.notification.count,
    ).mock.calls[0] as [{ where: any }];

    const listNow = listWhere.AND.find((c: any) => c.OR).OR[1]
      .expiresAt.gt;
    const countNow = countWhere.OR[1].expiresAt.gt;

    expect(listNow.getTime()).toBe(countNow.getTime());
  });

  it("filters to unread when unreadOnly=true", async () => {
    await GET(request("?unreadOnly=true"));

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ read: false }),
      }),
    );
  });

  it("does not filter to unread by default", async () => {
    await GET(request());

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    expect(where).not.toHaveProperty("read");
  });

  it("returns a cursor when more rows exist", async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      notificationRow(`n-${index}`, {
        createdAt: new Date(
          `2026-01-0${index + 1}T00:00:00.000Z`,
        ),
      }),
    );

    vi.mocked(prisma.notification.findMany).mockResolvedValue(
      rows as never,
    );

    const response = await GET(request("?limit=2"));
    const body = await response.json();

    expect(body.notifications).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeTruthy();
  });

  it("returns a null cursor on the last page", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      notificationRow("n-1"),
    ] as never);

    const response = await GET(request("?limit=20"));
    const body = await response.json();

    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
  });

  it("keeps the legacy notifications key alongside items", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      notificationRow("n-1"),
    ] as never);
    vi.mocked(prisma.notification.count).mockResolvedValue(
      4 as never,
    );

    const response = await GET(request());
    const body = await response.json();

    expect(body.notifications).toHaveLength(1);
    expect(body.items).toHaveLength(1);
    expect(body.unreadCount).toBe(4);
  });

  it("returns 400 for a malformed limit", async () => {
    const response = await GET(request("?limit=abc"));

    expect(response.status).toBe(400);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed cursor", async () => {
    const response = await GET(request("?cursor=not-a-cursor"));

    expect(response.status).toBe(400);
  });

  it("returns 500 when the query fails", async () => {
    vi.mocked(prisma.notification.findMany).mockRejectedValue(
      new Error("db down") as never,
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
  });
});

describe("PATCH /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 3,
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await PATCH();

    expect(response.status).toBe(401);
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it("marks only the caller's unread notifications", async () => {
    const response = await PATCH();
    const body = await response.json();

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", read: false },
      data: { read: true },
    });
    expect(body).toEqual({ ok: true, updated: 3 });
  });

  it("returns 500 when the update fails", async () => {
    vi.mocked(prisma.notification.updateMany).mockRejectedValue(
      new Error("db down") as never,
    );

    const response = await PATCH();

    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 2,
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("clears only the read notifications by default", async () => {
    const response = await DELETE(request());
    const body = await response.json();

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", read: true },
    });
    expect(body).toEqual({ ok: true, deleted: 2 });
  });

  it("clears everything with ?all=true", async () => {
    await DELETE(request("?all=true"));

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(prisma.notification.deleteMany).mockRejectedValue(
      new Error("db down") as never,
    );

    const response = await DELETE(request());

    expect(response.status).toBe(500);
  });
});
