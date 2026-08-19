import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { DELETE } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function request() {
  return new NextRequest(
    "http://localhost/api/notifications/n-1",
  );
}

const params = { params: { id: "n-1" } };

describe("DELETE /api/notifications/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 1,
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await DELETE(request(), params);

    expect(response.status).toBe(401);
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes the delete to the caller", async () => {
    const response = await DELETE(request(), params);

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: "n-1", userId: "user-1" },
    });
    expect(response.status).toBe(200);
  });

  it("returns 404 when the notification belongs to someone else", async () => {
    // deleteMany with a userId filter removes nothing rather than throwing,
    // which is exactly what makes it safe against id guessing.
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 0,
    } as never);

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(prisma.notification.deleteMany).mockRejectedValue(
      new Error("db down") as never,
    );

    const response = await DELETE(request(), params);

    expect(response.status).toBe(500);
  });
});
