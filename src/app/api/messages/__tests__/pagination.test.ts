import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { encodeCursor } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { GET } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    message: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  triggerPusher: vi.fn(() => Promise.resolve()),
}));

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/messages${query}`,
  );
}

function message(id: string, isoDate: string) {
  return {
    id,
    text: id,
    createdAt: new Date(isoDate),
  };
}

describe("GET /api/messages pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
      id: "conv-1",
    } as never);
  });

  it("takes limit + 1 rows newest first", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue(
      [] as never,
    );

    await GET(
      request("?conversationId=conv-1&limit=2"),
    );

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1" },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 3,
      }),
    );
  });

  it("defaults to a bounded page instead of the whole thread", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue(
      [] as never,
    );

    await GET(request("?conversationId=conv-1"));

    const call = vi.mocked(prisma.message.findMany).mock
      .calls[0][0] as { take: number };

    expect(call.take).toBe(21);
  });

  it("caps an oversized limit at MAX_PAGE_LIMIT", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue(
      [] as never,
    );

    await GET(
      request("?conversationId=conv-1&limit=5000"),
    );

    const call = vi.mocked(prisma.message.findMany).mock
      .calls[0][0] as { take: number };

    expect(call.take).toBe(101);
  });

  it("returns the messages alias oldest-first for rendering", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      message("msg-3", "2026-08-03T00:00:00.000Z"),
      message("msg-2", "2026-08-02T00:00:00.000Z"),
      message("msg-1", "2026-08-01T00:00:00.000Z"),
    ] as never);

    const response = await GET(
      request("?conversationId=conv-1"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.messages.map((m: { id: string }) => m.id),
    ).toEqual(["msg-1", "msg-2", "msg-3"]);
    // `items` stays in query order so the cursor lines up with the last row.
    expect(
      body.items.map((m: { id: string }) => m.id),
    ).toEqual(["msg-3", "msg-2", "msg-1"]);
  });

  it("reports hasMore and the cursor of the oldest returned row", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      message("msg-3", "2026-08-03T00:00:00.000Z"),
      message("msg-2", "2026-08-02T00:00:00.000Z"),
      message("msg-1", "2026-08-01T00:00:00.000Z"),
    ] as never);

    const response = await GET(
      request("?conversationId=conv-1&limit=2"),
    );
    const body = await response.json();

    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.nextCursor).toBe(
      encodeCursor({
        id: "msg-2",
        timestamp: "2026-08-02T00:00:00.000Z",
      }),
    );
    expect(body.messages).toHaveLength(2);
  });

  it("has no next cursor on the last page", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      message("msg-1", "2026-08-01T00:00:00.000Z"),
    ] as never);

    const response = await GET(
      request("?conversationId=conv-1&limit=5"),
    );
    const body = await response.json();

    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
  });

  it("applies a cursor to walk further back", async () => {
    vi.mocked(prisma.message.findMany).mockResolvedValue(
      [] as never,
    );

    const cursor = encodeCursor({
      id: "msg-2",
      timestamp: "2026-08-02T00:00:00.000Z",
    });

    await GET(
      request(
        `?conversationId=conv-1&cursor=${cursor}`,
      ),
    );

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: "conv-1",
          OR: [
            {
              createdAt: {
                lt: new Date("2026-08-02T00:00:00.000Z"),
              },
            },
            {
              createdAt: new Date(
                "2026-08-02T00:00:00.000Z",
              ),
              id: { lt: "msg-2" },
            },
          ],
        },
      }),
    );
  });

  it("rejects a malformed cursor with 400", async () => {
    const response = await GET(
      request(
        "?conversationId=conv-1&cursor=not-a-cursor",
      ),
    );

    expect(response.status).toBe(400);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed limit with 400", async () => {
    const response = await GET(
      request("?conversationId=conv-1&limit=-4"),
    );

    expect(response.status).toBe(400);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("still 404s for a conversation the caller is not in", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await GET(
      request("?conversationId=conv-9"),
    );

    expect(response.status).toBe(404);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});
