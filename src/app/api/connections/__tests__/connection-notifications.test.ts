import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  NotificationType: {
    CONNECTION_REQUEST: "CONNECTION_REQUEST",
    CONNECTION_ACCEPTED: "CONNECTION_ACCEPTED",
    MATCH_FOUND: "MATCH_FOUND",
    TICKET_VERIFIED: "TICKET_VERIFIED",
    TICKET_REJECTED: "TICKET_REJECTED",
    ACCOUNT_VERIFIED: "ACCOUNT_VERIFIED",
    MESSAGE: "MESSAGE",
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    connectionRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/blocking", () => ({
  isBlockedBetween: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/pusher", () => ({
  triggerPusher: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 20,
    remaining: 19,
    resetSeconds: 60,
    bypassed: false,
  }),
}));

import { POST } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { NotificationType } from "@prisma/client";

describe("POST /api/connections - notification persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (body: any) => {
    return {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as any;
  };

  it("persists CONNECTION_REQUEST notification when sending connection request", async () => {
    (auth as any).mockResolvedValue({
      user: { id: "user-1", name: "Alice" },
    });
    (prisma.connectionRequest.findFirst as any).mockResolvedValue(null);
    (prisma.connectionRequest.create as any).mockResolvedValue({
      id: "req-1",
      senderId: "user-1",
      receiverId: "user-2",
      status: "PENDING",
    });

    const req = createRequest({ action: "send", userId: "user-2" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        type: NotificationType.CONNECTION_REQUEST,
        title: "New connection request",
        content: "Alice sent you a connection request.",
      }),
    );
  });

  it("persists CONNECTION_ACCEPTED notification when accepting connection request", async () => {
    (auth as any).mockResolvedValue({
      user: { id: "user-2", name: "Bob" },
    });
    (prisma.connectionRequest.findUnique as any).mockResolvedValue({
      id: "req-1",
      senderId: "user-1",
      receiverId: "user-2",
      status: "PENDING",
    });
    (prisma.connectionRequest.update as any).mockResolvedValue({
      id: "req-1",
      status: "ACCEPTED",
    });
    (prisma.conversation.findFirst as any).mockResolvedValue({ id: "conv-1" });

    const req = createRequest({ action: "accept", userId: "user-1" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: NotificationType.CONNECTION_ACCEPTED,
        title: "Connection accepted",
        content: "Bob accepted your connection request.",
      }),
    );
  });
});
