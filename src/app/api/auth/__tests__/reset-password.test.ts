import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { POST } from "../reset-password/route";
import prisma from "@/lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/reset-password", () => {
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

  it("returns 400 for missing token or invalid inputs", async () => {
    const req = createRequest({ password: "password123" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid inputs");
  });

  it("returns 400 for password less than 8 characters", async () => {
    const req = createRequest({ token: "some-token", password: "short" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid inputs");
  });

  it("returns 400 if token is invalid or expired", async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue(null);

    const req = createRequest({ token: "invalid-token", password: "password123" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid or expired reset token");
  });

  it("returns 200 and resets password if token is valid and unexpired", async () => {
    const mockUser = {
      id: "user123",
      email: "test@example.com",
      resetToken: "valid-token",
      resetTokenExpires: new Date(Date.now() + 60000),
    };
    ;(prisma.user.findFirst as any).mockResolvedValue(mockUser);
    ;(prisma.user.update as any).mockResolvedValue(mockUser);

    const req = createRequest({ token: "valid-token", password: "newpassword123" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toContain("Password reset successful");

    expect(prisma.user.update).toHaveBeenCalled();
  });
});
