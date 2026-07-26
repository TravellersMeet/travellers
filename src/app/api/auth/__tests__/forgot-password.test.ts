import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

import { POST } from "../forgot-password/route";
import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/forgot-password", () => {
  const createRequest = (bodyData: any) => {
    return {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "content-type") {
            return "application/json";
          }
          return null;
        },
      } as any,
      json: async () => bodyData,
    } as any;
  };

  it("returns 400 for invalid email", async () => {
    const req = createRequest({ email: "not-an-email" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid email input");
  });

  it("returns generic success even if user not found (security)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null);

    const req = createRequest({ email: "unknown@example.com" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toContain("If an account exists");
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns 200, updates user token, and sends email if user exists", async () => {
    const mockUser = {
      id: "user123",
      email: "test@example.com",
      name: "Test User",
    };
    ;(prisma.user.findUnique as any).mockResolvedValue(mockUser);
    ;(prisma.user.update as any).mockResolvedValue(mockUser);

    const req = createRequest({ email: "test@example.com" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "test@example.com" } });
    expect(prisma.user.update).toHaveBeenCalled();
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });
});
