import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { encodeCursor } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { DELETE, GET, POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    block: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    connectionRequest: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function jsonRequest(body: unknown) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "application/json"
          : null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

function listRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/user/block${query}`,
  );
}

describe("GET /api/user/block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(listRequest());

    expect(response.status).toBe(401);
  });

  it("returns the caller's blocks newest first", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      {
        id: "block-2",
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        blocked: { id: "user-3", name: "Ravi" },
      },
      {
        id: "block-1",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        blocked: { id: "user-2", name: "Nadia" },
      },
    ] as never);

    const response = await GET(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.blockedUsers[0]).toEqual({
      id: "user-3",
      name: "Ravi",
      blockedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(prisma.block.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockerId: "user-1" },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });

  it("never selects credential columns of the blocked user", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue(
      [] as never,
    );

    await GET(listRequest());

    const call = vi.mocked(prisma.block.findMany).mock
      .calls[0][0] as {
      select: { blocked: { select: Record<string, boolean> } };
    };

    expect(call.select.blocked.select).toEqual({
      id: true,
      name: true,
      image: true,
      location: true,
    });
  });

  it("reports hasMore and a cursor when the page is full", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      {
        id: "block-3",
        createdAt: new Date("2026-08-03T00:00:00.000Z"),
        blocked: { id: "user-4" },
      },
      {
        id: "block-2",
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        blocked: { id: "user-3" },
      },
      {
        id: "block-1",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        blocked: { id: "user-2" },
      },
    ] as never);

    const response = await GET(listRequest("?limit=2"));
    const body = await response.json();

    expect(body.items).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBe(
      encodeCursor({
        id: "block-2",
        timestamp: "2026-08-02T00:00:00.000Z",
      }),
    );
  });

  it("rejects a malformed limit with 400", async () => {
    const response = await GET(listRequest("?limit=abc"));

    expect(response.status).toBe(400);
    expect(prisma.block.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/user/block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
  });

  it("refuses to block a soft-deleted account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-2",
      isDeleted: true,
    } as never);

    const response = await POST(
      jsonRequest({ blockedId: "user-2" }),
    );

    expect(response.status).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("clears a pending connection request alongside the block", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-2",
      isDeleted: false,
    } as never);
    vi.mocked(prisma.block.findUnique).mockResolvedValue(
      null as never,
    );

    const response = await POST(
      jsonRequest({ blockedId: "user-2" }),
    );

    expect(response.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(
      prisma.connectionRequest.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        OR: [
          { senderId: "user-1", receiverId: "user-2" },
          { senderId: "user-2", receiverId: "user-1" },
        ],
      },
    });
  });

  it("only selects the columns needed to validate the target", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-2",
      isDeleted: false,
    } as never);
    vi.mocked(prisma.block.findUnique).mockResolvedValue(
      null as never,
    );

    await POST(jsonRequest({ blockedId: "user-2" }));

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-2" },
      select: { id: true, isDeleted: true },
    });
  });

  it("is idempotent when the block already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-2",
      isDeleted: false,
    } as never);
    vi.mocked(prisma.block.findUnique).mockResolvedValue({
      id: "block-1",
    } as never);

    const response = await POST(
      jsonRequest({ blockedId: "user-2" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("User is already blocked");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/user/block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await DELETE(
      jsonRequest({ blockedId: "user-2" }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when blockedId is missing", async () => {
    const response = await DELETE(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(prisma.block.deleteMany).not.toHaveBeenCalled();
  });

  it("removes only the caller's own block row", async () => {
    vi.mocked(prisma.block.deleteMany).mockResolvedValue({
      count: 1,
    } as never);

    const response = await DELETE(
      jsonRequest({ blockedId: "user-2" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(prisma.block.deleteMany).toHaveBeenCalledWith({
      where: {
        blockerId: "user-1",
        blockedId: "user-2",
      },
    });
  });

  it("returns 404 when the caller never blocked that user", async () => {
    vi.mocked(prisma.block.deleteMany).mockResolvedValue({
      count: 0,
    } as never);

    const response = await DELETE(
      jsonRequest({ blockedId: "user-9" }),
    );

    expect(response.status).toBe(404);
  });
});
