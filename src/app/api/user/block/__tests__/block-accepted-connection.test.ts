import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    block: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    connectionRequest: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return Promise.all(callback);
    }),
  },
}));

import { POST } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

describe("POST /api/user/block - remove all connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (body: any) => {
    return {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as any;
  };

  it("removes all connection requests (including ACCEPTED) when blocking a user", async () => {
    (auth as any).mockResolvedValue({
      user: { id: "user-1" },
    });

    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user-2",
      isDeleted: false,
    });

    (prisma.block.findUnique as any).mockResolvedValue(null);

    const req = createRequest({ blockedId: "user-2" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);

    expect(prisma.connectionRequest.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { senderId: "user-1", receiverId: "user-2" },
          { senderId: "user-2", receiverId: "user-1" },
        ],
      },
    });
  });
});
