import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
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

function request() {
  return new NextRequest("http://localhost/api/conversations");
}

describe("GET /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.conversation.findMany).mockResolvedValue(
      [] as never,
    );
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it("does not add a block filter when nothing is blocked", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue(
      [] as never,
    );

    await GET(request());

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          users: {
            some: { id: "user-1" },
          },
        },
      }),
    );
  });

  it("excludes conversations that include a blocked user", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      { blockerId: "user-1", blockedId: "user-2" },
      { blockerId: "user-3", blockedId: "user-1" },
    ] as never);

    await GET(request());

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          users: {
            some: { id: "user-1" },
            none: { id: { in: ["user-2", "user-3"] } },
          },
        },
      }),
    );
  });

  it("formats the sidebar payload", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue(
      [] as never,
    );
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      {
        id: "conv-1",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-02T00:00:00.000Z"),
        users: [{ id: "user-2", name: "Nadia" }],
        messages: [{ id: "msg-1", text: "See you there" }],
      },
    ] as never);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].otherUser.name).toBe("Nadia");
    expect(body.conversations[0].lastMessage.text).toBe(
      "See you there",
    );
  });

  it("returns nulls for an empty conversation", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue(
      [] as never,
    );
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      {
        id: "conv-2",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        users: [],
        messages: [],
      },
    ] as never);

    const response = await GET(request());
    const body = await response.json();

    expect(body.conversations[0].otherUser).toBeNull();
    expect(body.conversations[0].lastMessage).toBeNull();
  });
});
