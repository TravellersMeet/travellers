import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn(), update: vi.fn() } } }));

import { PATCH } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

describe("PATCH /api/user/profile - socialLinks type handling", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const createNextRequest = (body: any) => ({ headers: new Headers(), json: async () => body }) as any;

  it("filters socialLinks when passed as an object instead of throwing a validation error", async () => {
    (auth as any).mockResolvedValue({ user: { email: "user@example.com", id: "user-123" } });
    (prisma.user.findUnique as any).mockResolvedValue({ isDeleted: false });
    (prisma.user.update as any).mockResolvedValue({ id: "user-123", email: "user@example.com", socialLinks: [] });
    const res = await PATCH(createNextRequest({ socialLinks: { twitter: "https://x.com/user" } }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "user@example.com" }, data: expect.objectContaining({ socialLinks: undefined }) }));
  });

  it("updates socialLinks properly when passed a valid string array", async () => {
    (auth as any).mockResolvedValue({ user: { email: "user@example.com", id: "user-123" } });
    (prisma.user.findUnique as any).mockResolvedValue({ isDeleted: false });
    const validLinks = ["https://x.com/user", "https://github.com/user"];
    (prisma.user.update as any).mockResolvedValue({ id: "user-123", email: "user@example.com", socialLinks: validLinks });
    const res = await PATCH(createNextRequest({ socialLinks: validLinks }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "user@example.com" }, data: expect.objectContaining({ socialLinks: validLinks }) }));
  });
});
