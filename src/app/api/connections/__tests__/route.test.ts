import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { GET, POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    connectionRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    block: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  triggerPusher: vi.fn(() => Promise.resolve()),
}));

/**
 * The rate limiter reads `x-forwarded-for` to build its identifier, so a mock
 * request needs a `headers` bag even when the header itself is absent.
 */
function postRequest(body: any) {
  return {
    headers: {
      get: () => null,
    },
    json: async () => body,
  };
}

function getRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/connections${query}`,
  );
}

/**
 * `getBlockedUserIds` reads Block rows in both directions and reduces them to
 * the counterpart ids. Driving it through the prisma mock rather than stubbing
 * the helper keeps the real symmetry logic under test.
 */
function blockedWith(...counterpartIds: string[]) {
  (prisma.block.findMany as any).mockResolvedValue(
    counterpartIds.map((id, index) =>
      index % 2 === 0
        ? { blockerId: "user-1", blockedId: id }
        : { blockerId: id, blockedId: "user-1" },
    ),
  );
}

/**
 * The three findMany calls run inside one Promise.all, in the order
 * incoming, outgoing, accepted.
 */
function callArgs(index: 0 | 1 | 2) {
  return (prisma.connectionRequest.findMany as any).mock.calls[
    index
  ][0] as { where: any; orderBy: any; take: number };
}

function acceptedRow(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    senderId: "user-1",
    receiverId: "user-2",
    status: "ACCEPTED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    sender: { id: "user-1", name: "Me" },
    receiver: { id: "user-2", name: "Them" },
    ...overrides,
  };
}

describe("Connections API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as any).mockResolvedValue({ user: { id: "user-1", name: "User 1" } });
    // Default: neither user has blocked the other.
    (prisma.block.findFirst as any).mockResolvedValue(null);
    (prisma.block.findMany as any).mockResolvedValue([]);
    (prisma.connectionRequest.findMany as any).mockResolvedValue([]);
  });

  describe("GET /api/connections", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as any).mockResolvedValue(null);
      const res = await GET(getRequest());
      expect(res.status).toBe(401);
      expect(
        prisma.connectionRequest.findMany,
      ).not.toHaveBeenCalled();
    });

    it("returns connection lists", async () => {
      const res = await GET(getRequest());
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveProperty("incoming");
      expect(data).toHaveProperty("outgoing");
      expect(data).toHaveProperty("connections");
    });

    it("resolves the block set once, not per row", async () => {
      blockedWith("blocked-1", "blocked-2");

      await GET(getRequest());

      expect(prisma.block.findMany).toHaveBeenCalledTimes(1);
    });

    it("adds no block filter when nothing is blocked", async () => {
      await GET(getRequest());

      expect(callArgs(0).where).toEqual({
        receiverId: "user-1",
        status: "PENDING",
      });
      expect(callArgs(1).where).toEqual({
        senderId: "user-1",
        status: "PENDING",
      });
      expect(callArgs(2).where.OR).toEqual([
        { senderId: "user-1" },
        { receiverId: "user-1" },
      ]);
    });

    it("hides incoming requests from a blocked sender", async () => {
      blockedWith("blocked-1");

      await GET(getRequest());

      expect(callArgs(0).where).toEqual({
        receiverId: "user-1",
        status: "PENDING",
        senderId: { notIn: ["blocked-1"] },
      });
    });

    it("hides outgoing requests to a blocked receiver", async () => {
      blockedWith("blocked-1");

      await GET(getRequest());

      expect(callArgs(1).where).toEqual({
        senderId: "user-1",
        status: "PENDING",
        receiverId: { notIn: ["blocked-1"] },
      });
    });

    it("hides accepted connections on either side of a block", async () => {
      blockedWith("blocked-1");

      await GET(getRequest());

      // The filter has to sit inside each OR branch: the counterpart is the
      // receiver when the caller sent the request and the sender when they
      // received it.
      expect(callArgs(2).where.OR).toEqual([
        {
          senderId: "user-1",
          receiverId: { notIn: ["blocked-1"] },
        },
        {
          receiverId: "user-1",
          senderId: { notIn: ["blocked-1"] },
        },
      ]);
    });

    it("covers blocks in both directions with one id list", async () => {
      // blockedWith alternates the direction of each Block row, so this
      // asserts the symmetry getBlockedUserIds is responsible for.
      blockedWith("i-blocked-them", "they-blocked-me");

      await GET(getRequest());

      expect(callArgs(2).where.OR[0].receiverId.notIn).toEqual([
        "i-blocked-them",
        "they-blocked-me",
      ]);
    });

    it("runs the three queries concurrently rather than serially", async () => {
      let resolveFirst: (value: unknown) => void = () => {};
      let started = 0;

      (prisma.connectionRequest.findMany as any).mockImplementation(
        () => {
          started += 1;

          if (started === 1) {
            return new Promise((resolve) => {
              resolveFirst = resolve;
            });
          }

          return Promise.resolve([]);
        },
      );

      const pending = GET(getRequest());

      // Let the handler get past its `await getBlockedUserIds(...)` and reach
      // the Promise.all. All three are then in flight even though the first
      // has not settled — the serial version would sit at one.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(started).toBe(3);

      resolveFirst([]);
      await pending;
    });

    it("bounds the pending lists", async () => {
      await GET(getRequest());

      expect(callArgs(0).take).toBe(100);
      expect(callArgs(1).take).toBe(100);
    });

    it("paginates the accepted list with a stable ordering", async () => {
      await GET(getRequest("?limit=5"));

      expect(callArgs(2).take).toBe(6);
      expect(callArgs(2).orderBy).toEqual([
        { updatedAt: "desc" },
        { id: "desc" },
      ]);
    });

    it("returns a cursor when more connections exist", async () => {
      (prisma.connectionRequest.findMany as any).mockImplementation(
        async (args: any) =>
          args.where.status === "ACCEPTED"
            ? [
                acceptedRow("req-1"),
                acceptedRow("req-2"),
                acceptedRow("req-3"),
              ]
            : [],
      );

      const res = await GET(getRequest("?limit=2"));
      const data = await res.json();

      expect(data.connections).toHaveLength(2);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.nextCursor).toBeTruthy();
    });

    it("maps each accepted row to the other participant", async () => {
      (prisma.connectionRequest.findMany as any).mockImplementation(
        async (args: any) =>
          args.where.status === "ACCEPTED"
            ? [
                acceptedRow("req-1"),
                acceptedRow("req-2", {
                  senderId: "user-3",
                  receiverId: "user-1",
                  sender: { id: "user-3", name: "Sender" },
                  receiver: { id: "user-1", name: "Me" },
                }),
              ]
            : [],
      );

      const res = await GET(getRequest());
      const data = await res.json();

      expect(data.connections[0].user.id).toBe("user-2");
      expect(data.connections[1].user.id).toBe("user-3");
    });

    it("returns 400 for a malformed cursor", async () => {
      const res = await GET(getRequest("?cursor=nonsense"));

      expect(res.status).toBe(400);
      expect(
        prisma.connectionRequest.findMany,
      ).not.toHaveBeenCalled();
    });

    it("returns 400 for a malformed limit", async () => {
      const res = await GET(getRequest("?limit=-3"));

      expect(res.status).toBe(400);
    });

    it("returns 500 when a query fails", async () => {
      (prisma.connectionRequest.findMany as any).mockRejectedValue(
        new Error("db down"),
      );

      const res = await GET(getRequest());

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/connections", () => {
    it("sends connection request", async () => {
      (prisma.connectionRequest.findFirst as any).mockResolvedValue(null);
      (prisma.connectionRequest.create as any).mockResolvedValue({ id: "req-1", senderId: "user-1", receiverId: "user-2" });

      const req = postRequest({ action: "send", userId: "user-2" });

      const res = await POST(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.connectionRequest.create).toHaveBeenCalled();
    });

    it("accepts connection request and creates conversation", async () => {
      (prisma.connectionRequest.findUnique as any).mockResolvedValue({ id: "req-1", senderId: "user-2", receiverId: "user-1", status: "PENDING" });
      (prisma.conversation.findFirst as any).mockResolvedValue(null);
      (prisma.conversation.create as any).mockResolvedValue({ id: "conv-1" });

      const req = postRequest({ action: "accept", userId: "user-2" });

      const res = await POST(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.conversationId).toBe("conv-1");
      expect(prisma.conversation.create).toHaveBeenCalled();
    });

    it("refuses to send a request when either side has blocked the other", async () => {
      (prisma.block.findFirst as any).mockResolvedValue({ id: "block-1" });

      const req = postRequest({ action: "send", userId: "user-2" });

      const res = await POST(req as any);

      expect(res.status).toBe(403);
      expect(prisma.connectionRequest.create).not.toHaveBeenCalled();
    });

    it("refuses to accept a request created before the block", async () => {
      (prisma.connectionRequest.findUnique as any).mockResolvedValue({ id: "req-1", senderId: "user-2", receiverId: "user-1", status: "PENDING" });
      (prisma.block.findFirst as any).mockResolvedValue({ id: "block-1" });

      const req = postRequest({ action: "accept", userId: "user-2" });

      const res = await POST(req as any);

      expect(res.status).toBe(403);
      expect(prisma.connectionRequest.update).not.toHaveBeenCalled();
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });
  });
});
