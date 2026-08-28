import type { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  isMockAuthAllowed,
  pusherServer,
} from "@/lib/pusher";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { authorizeChannel: vi.fn() },
  isMockAuthAllowed: vi.fn(),
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

const ALLOWED = {
  allowed: true,
  limit: 60,
  remaining: 59,
  resetAt: 0,
  retryAfter: 0,
  bypassed: false,
};

function pusherRequest(body: unknown) {
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

function subscribe(
  channel_name: string,
  socket_id = "123.456",
) {
  return POST(
    pusherRequest({ socket_id, channel_name }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(enforceRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    id: "user-1",
  } as never);
  vi.mocked(isMockAuthAllowed).mockReturnValue(false);
  vi.mocked(
    pusherServer!.authorizeChannel,
  ).mockReturnValue({ auth: "real-signature" } as never);
});

describe("POST /api/pusher/auth", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await subscribe(
      "private-user-user-1",
    );

    expect(response.status).toBe(401);
  });

  it("authorises the caller's own user channel", async () => {
    const response = await subscribe(
      "private-user-user-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      auth: "real-signature",
    });
    expect(
      pusherServer!.authorizeChannel,
    ).toHaveBeenCalledWith(
      "123.456",
      "private-user-user-1",
    );
  });

  it("refuses somebody else's user channel", async () => {
    const response = await subscribe(
      "private-user-user-2",
    );

    expect(response.status).toBe(403);
    expect(
      pusherServer!.authorizeChannel,
    ).not.toHaveBeenCalled();
  });

  it("authorises a conversation the caller is in", async () => {
    vi.mocked(
      prisma.conversation.findFirst,
    ).mockResolvedValue({ id: "conv-1" } as never);

    const response = await subscribe(
      "private-chat-conv-1",
    );

    expect(response.status).toBe(200);
    expect(
      prisma.conversation.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "conv-1",
          users: { some: { id: "user-1" } },
        },
      }),
    );
  });

  it("refuses a conversation the caller is not in", async () => {
    vi.mocked(
      prisma.conversation.findFirst,
    ).mockResolvedValue(null as never);

    const response = await subscribe(
      "private-chat-conv-9",
    );

    expect(response.status).toBe(403);
    expect(
      pusherServer!.authorizeChannel,
    ).not.toHaveBeenCalled();
  });

  describe("channel name grammar", () => {
    it.each([
      ["a bare prefix", "private-user-"],
      ["a doubled prefix", "private-user-private-user-x"],
      ["a public channel", "some-channel"],
      ["a presence channel", "presence-room-1"],
      ["an unrelated private channel", "private-admin-1"],
    ])("rejects %s", async (_label, channel) => {
      const response = await subscribe(channel);

      expect([400, 403]).toContain(response.status);
      expect(
        pusherServer!.authorizeChannel,
      ).not.toHaveBeenCalled();
    });

    it("rejects a channel name past Pusher's 164-character limit", async () => {
      const response = await subscribe(
        `private-chat-${"a".repeat(300)}`,
      );

      expect(response.status).toBe(400);
      expect(
        prisma.conversation.findFirst,
      ).not.toHaveBeenCalled();
    });

    it.each([
      ["empty", ""],
      ["malformed", "not-a-socket-id"],
      ["oversized", "1".repeat(200)],
    ])("rejects a %s socket_id", async (_label, socketId) => {
      const response = await subscribe(
        "private-user-user-1",
        socketId,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("when Pusher is not configured", () => {
    it("fails closed with 503 rather than minting a signature", async () => {
      vi.doMock("@/lib/pusher", () => ({
        pusherServer: null,
        isMockAuthAllowed: () => false,
      }));
      vi.resetModules();

      const { POST: freshPost } = await import(
        "../route"
      );
      const response = await freshPost(
        pusherRequest({
          socket_id: "123.456",
          channel_name: "private-user-user-1",
        }),
      );

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.auth).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(
        "user-1",
      );

      vi.doUnmock("@/lib/pusher");
      vi.resetModules();
    });

    it("returns a mock only when explicitly allowed, and without the user id", async () => {
      vi.doMock("@/lib/pusher", () => ({
        pusherServer: null,
        isMockAuthAllowed: () => true,
      }));
      vi.resetModules();

      const { POST: freshPost } = await import(
        "../route"
      );
      const response = await freshPost(
        pusherRequest({
          socket_id: "123.456",
          channel_name: "private-user-user-1",
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        auth: "mock-auth-signature",
        mock: true,
      });
      expect(body.auth).not.toContain("user-1");

      vi.doUnmock("@/lib/pusher");
      vi.resetModules();
    });
  });

  it("refuses a soft-deleted account holding a live session", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await subscribe(
      "private-user-user-1",
    );

    expect(response.status).toBe(403);
    expect(
      pusherServer!.authorizeChannel,
    ).not.toHaveBeenCalled();
  });

  it("throttles the endpoint", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue({
      ...ALLOWED,
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    });

    const response = await subscribe(
      "private-user-user-1",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(
      "30",
    );
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "pusherAuth",
      "user-1",
    );
  });

  it("reports rate-limit headers on a successful authorisation", async () => {
    const response = await subscribe(
      "private-user-user-1",
    );

    expect(
      response.headers.get("X-RateLimit-Limit"),
    ).toBe("60");
    expect(
      response.headers.get("X-RateLimit-Remaining"),
    ).toBe("59");
  });

  it("returns 500 when Pusher itself rejects the request", async () => {
    vi.mocked(
      pusherServer!.authorizeChannel,
    ).mockImplementation(() => {
      throw new Error("bad credentials");
    });

    const response = await subscribe(
      "private-user-user-1",
    );

    expect(response.status).toBe(500);
  });
});

describe("isMockAuthAllowed", () => {
  const actual = () =>
    vi.importActual<typeof import("@/lib/pusher")>(
      "@/lib/pusher",
    );

  it("is off in production", async () => {
    const { isMockAuthAllowed: real } = await actual();

    expect(
      real({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("is on for tests and local development", async () => {
    const { isMockAuthAllowed: real } = await actual();

    expect(
      real({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      real({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("honours an explicit production opt-in", async () => {
    const { isMockAuthAllowed: real } = await actual();

    expect(
      real({
        NODE_ENV: "production",
        PUSHER_ALLOW_MOCK_AUTH: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
