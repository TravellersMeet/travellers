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

describe("Connections API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as any).mockResolvedValue({ user: { id: "user-1", name: "User 1" } });
    // Default: neither user has blocked the other.
    (prisma.block.findFirst as any).mockResolvedValue(null);
  });

  describe("GET /api/connections", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as any).mockResolvedValue(null);
      const res = await GET({} as any);
      expect(res.status).toBe(401);
    });

    it("returns connection lists", async () => {
      (prisma.connectionRequest.findMany as any).mockResolvedValue([]);
      const res = await GET({} as any);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data).toHaveProperty("incoming");
      expect(data).toHaveProperty("outgoing");
      expect(data).toHaveProperty("connections");
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
