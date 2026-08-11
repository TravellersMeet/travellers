import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { GET, PATCH } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

describe("GET / PATCH /api/user/profile - soft deleted user handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createNextRequest = (body?: any) => {
    return {
      headers: new Headers(),
      json: async () => body,
    } as any;
  };

  it("returns 404 on GET if the account is soft-deleted (isDeleted: true)", async () => {
    (auth as any).mockResolvedValue({
      user: { email: "deleted@example.com" },
    });

    (prisma.user.findUnique as any).mockResolvedValue({
      name: "Deleted User",
      email: "deleted@example.com",
      isDeleted: true,
    });

    const req = createNextRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("User profile was not found");
  });

  it("returns 404 on PATCH if the account is soft-deleted (isDeleted: true)", async () => {
    (auth as any).mockResolvedValue({
      user: { email: "deleted@example.com" },
    });

    (prisma.user.findUnique as any).mockResolvedValue({
      isDeleted: true,
    });

    const req = createNextRequest({ name: "New Name" });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.message).toBe("User profile was not found");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
