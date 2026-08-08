import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { triggerPusher } from "@/lib/pusher";
import { GET, POST } from "../route";

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
    block: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    route: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((promises) => Promise.all(promises)),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  triggerPusher: vi.fn(() => Promise.resolve()),
}));

/** The shape `loadConversationForUser` selects. */
function conversationWith(...userIds: string[]) {
  return {
    id: "conv-1",
    users: userIds.map((id) => ({ id })),
  };
}

describe("Messages API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as any).mockResolvedValue({ user: { id: "user-1", name: "User 1" } });
    // Default: no block between the participants.
    (prisma.block.findFirst as any).mockResolvedValue(null);
  });

  describe("GET /api/messages", () => {
    it("returns 400 if conversationId is missing", async () => {
      const req = {
        url: "http://localhost:3000/api/messages",
      };
      const res = await GET(req as any);
      expect(res.status).toBe(400);
    });

    it("returns messages for a valid conversation", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.message.findMany as any).mockResolvedValue([{ id: "msg-1", text: "Hello" }]);

      const req = {
        url: "http://localhost:3000/api/messages?conversationId=conv-1",
      };
      const res = await GET(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.messages).toHaveLength(1);
    });

    it("returns 403 when the other participant is blocked", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.block.findFirst as any).mockResolvedValue({ id: "block-1" });

      const req = {
        url: "http://localhost:3000/api/messages?conversationId=conv-1",
      };
      const res = await GET(req as any);

      expect(res.status).toBe(403);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it("checks the block against the other participants only", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.message.findMany as any).mockResolvedValue([]);

      const req = {
        url: "http://localhost:3000/api/messages?conversationId=conv-1",
      };
      await GET(req as any);

      expect(prisma.block.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { blockerId: "user-1", blockedId: { in: ["user-2"] } },
            { blockerId: { in: ["user-2"] }, blockedId: "user-1" },
          ],
        },
        select: { id: true },
      });
    });
  });

  describe("POST /api/messages", () => {
    it("sends a message and triggers pusher", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.message.create as any).mockResolvedValue({ id: "msg-2", text: "New message" });
      (prisma.conversation.update as any).mockResolvedValue({ id: "conv-1" });

      const req = {
        json: async () => ({ conversationId: "conv-1", text: "New message" }),
      };

      const res = await POST(req as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message.text).toBe("New message");
    });

    it("notifies every participant sidebar without re-querying the conversation", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.message.create as any).mockResolvedValue({ id: "msg-2", text: "New message" });
      (prisma.conversation.update as any).mockResolvedValue({ id: "conv-1" });

      const req = {
        json: async () => ({ conversationId: "conv-1", text: "New message" }),
      };

      await POST(req as any);

      expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
      expect(triggerPusher).toHaveBeenCalledWith(
        "private-user-user-1",
        "conversation-updated",
        expect.objectContaining({ conversationId: "conv-1" }),
      );
      expect(triggerPusher).toHaveBeenCalledWith(
        "private-user-user-2",
        "conversation-updated",
        expect.objectContaining({ conversationId: "conv-1" }),
      );
    });

    it("returns 403 and writes nothing when the sender is blocked", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(
        conversationWith("user-1", "user-2"),
      );
      (prisma.block.findFirst as any).mockResolvedValue({ id: "block-1" });

      const req = {
        json: async () => ({ conversationId: "conv-1", text: "Still here" }),
      };

      const res = await POST(req as any);

      expect(res.status).toBe(403);
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(triggerPusher).not.toHaveBeenCalled();
    });

    it("returns 404 when the caller is not a participant", async () => {
      (prisma.conversation.findFirst as any).mockResolvedValue(null);

      const req = {
        json: async () => ({ conversationId: "conv-9", text: "Hello?" }),
      };

      const res = await POST(req as any);

      expect(res.status).toBe(404);
      expect(prisma.block.findFirst).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });
});
