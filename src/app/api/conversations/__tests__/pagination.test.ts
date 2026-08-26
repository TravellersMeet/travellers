import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { GET } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    conversation: {
      findMany: vi.fn(),
    },
    block: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/conversations${query}`,
  );
}

/** Builds `count` conversation rows, newest first. */
function conversationRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `conv-${index + 1}`,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date(
      Date.UTC(2026, 7, 20, 0, 0, count - index),
    ),
    users: [{ id: `user-${index + 2}`, name: `Peer ${index}` }],
    messages: [],
  }));
}

function findManyArgs() {
  return vi.mocked(prisma.conversation.findMany).mock
    .calls[0][0] as Record<string, any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(prisma.block.findMany).mockResolvedValue(
    [] as never,
  );
  vi.mocked(prisma.conversation.findMany).mockResolvedValue(
    [] as never,
  );
});

describe("GET /api/conversations pagination", () => {
  it("applies the default page limit", async () => {
    await GET(request());

    expect(findManyArgs().take).toBe(DEFAULT_PAGE_LIMIT + 1);
  });

  it("honours an explicit limit", async () => {
    await GET(request("?limit=5"));

    expect(findManyArgs().take).toBe(6);
  });

  it("clamps a limit above the maximum", async () => {
    await GET(request(`?limit=${MAX_PAGE_LIMIT + 500}`));

    expect(findManyArgs().take).toBe(MAX_PAGE_LIMIT + 1);
  });

  it("orders by updatedAt with an id tiebreaker", async () => {
    await GET(request());

    expect(findManyArgs().orderBy).toEqual([
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("returns pagination metadata alongside the conversations", async () => {
    vi.mocked(
      prisma.conversation.findMany,
    ).mockResolvedValue(conversationRows(3) as never);

    const response = await GET(request("?limit=5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      limit: 5,
      nextCursor: null,
      hasMore: false,
    });
  });

  it("reports hasMore and a cursor when a page is full", async () => {
    // The handler asks for limit + 1 to detect the extra row.
    vi.mocked(
      prisma.conversation.findMany,
    ).mockResolvedValue(conversationRows(4) as never);

    const response = await GET(request("?limit=3"));
    const body = await response.json();

    expect(body.conversations).toHaveLength(3);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeTruthy();
  });

  it("points the cursor at the last item of the page", async () => {
    const rows = conversationRows(4);
    vi.mocked(
      prisma.conversation.findMany,
    ).mockResolvedValue(rows as never);

    const body = await (
      await GET(request("?limit=3"))
    ).json();

    expect(
      decodeCursor(body.pagination.nextCursor).id,
    ).toBe("conv-3");
  });

  it("applies a supplied cursor to the query", async () => {
    const cursor = encodeCursor({
      id: "conv-3",
      timestamp: "2026-08-20T00:00:00.000Z",
    });

    await GET(request(`?cursor=${cursor}`));

    expect(findManyArgs().where.OR).toEqual([
      {
        updatedAt: {
          lt: new Date("2026-08-20T00:00:00.000Z"),
        },
      },
      {
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        id: { lt: "conv-3" },
      },
    ]);
  });

  it("keeps the block filter on a cursored page", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      { blockerId: "user-1", blockedId: "user-2" },
    ] as never);

    const cursor = encodeCursor({
      id: "conv-3",
      timestamp: "2026-08-20T00:00:00.000Z",
    });

    await GET(request(`?cursor=${cursor}`));

    const where = findManyArgs().where;

    expect(where.users.none).toEqual({
      id: { in: ["user-2"] },
    });
    expect(where.OR).toBeDefined();
  });

  it("rejects an invalid cursor with 400", async () => {
    const response = await GET(
      request("?cursor=not-a-real-cursor"),
    );

    expect(response.status).toBe(400);
    expect(
      prisma.conversation.findMany,
    ).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric limit with 400", async () => {
    const response = await GET(request("?limit=abc"));

    expect(response.status).toBe(400);
  });

  it("rejects a zero limit with 400", async () => {
    const response = await GET(request("?limit=0"));

    expect(response.status).toBe(400);
  });

  it("keeps the conversations key the sidebar already reads", async () => {
    vi.mocked(
      prisma.conversation.findMany,
    ).mockResolvedValue(conversationRows(2) as never);

    const body = await (await GET(request())).json();

    expect(Array.isArray(body.conversations)).toBe(true);
    expect(body.conversations[0]).toMatchObject({
      id: "conv-1",
      otherUser: { name: "Peer 0" },
      lastMessage: null,
    });
  });

  it("counts a skipped conversation against the page, not the cursor", async () => {
    // A row with no counterpart is dropped from the payload, but it was still
    // a real row in the query — so hasMore must reflect the query, not the
    // filtered list.
    const rows = conversationRows(4);
    rows[0].users = [];

    vi.mocked(
      prisma.conversation.findMany,
    ).mockResolvedValue(rows as never);

    const body = await (
      await GET(request("?limit=3"))
    ).json();

    expect(body.conversations).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(true);
    expect(
      decodeCursor(body.pagination.nextCursor).id,
    ).toBe("conv-3");
  });

  it("returns 500 when the query fails", async () => {
    vi.mocked(
      prisma.conversation.findMany,
    ).mockRejectedValue(new Error("db down") as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request());

    expect(response.status).toBe(500);
  });
});
