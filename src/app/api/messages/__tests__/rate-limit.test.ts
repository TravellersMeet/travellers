import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { triggerPusher } from "@/lib/pusher";
import { POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    message: {
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

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

function postRequest(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

function allowed() {
  return {
    allowed: true,
    limit: 30,
    remaining: 29,
    resetAt: 1_800_000,
    retryAfter: 0,
    bypassed: false,
  };
}

function exceeded() {
  return {
    allowed: false,
    limit: 30,
    remaining: 0,
    resetAt: 1_800_000,
    retryAfter: 17,
    bypassed: false,
  };
}

describe("POST /api/messages rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
      id: "conv-1",
    } as never);
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      users: [{ id: "user-1" }, { id: "user-2" }],
    } as never);
    vi.mocked(prisma.message.create).mockResolvedValue({
      id: "msg-1",
      text: "hi",
    } as never);
    vi.mocked(enforceRateLimit).mockResolvedValue(allowed());
  });

  it("throttles on the sender id, not just the IP", async () => {
    await POST(
      postRequest({ conversationId: "conv-1", text: "hi" }),
    );

    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "messageSend",
      "user-1",
    );
  });

  it("returns 429 with Retry-After and writes nothing when exceeded", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue(exceeded());

    const response = await POST(
      postRequest({ conversationId: "conv-1", text: "hi" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe(
      "0",
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(triggerPusher).not.toHaveBeenCalled();
  });

  it("does not read the body when the limit is already exceeded", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue(exceeded());

    const json = vi.fn();
    await POST({ headers: { get: () => null }, json } as any);

    expect(json).not.toHaveBeenCalled();
  });

  it("returns the limit headers on a successful send", async () => {
    const response = await POST(
      postRequest({ conversationId: "conv-1", text: "hi" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe(
      "30",
    );
    expect(response.headers.get("X-RateLimit-Remaining")).toBe(
      "29",
    );
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
