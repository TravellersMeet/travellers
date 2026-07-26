import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { POST as blockPOST } from "../block/route";
import { POST as reportPOST } from "../report/route";
import { POST as onboardPOST } from "../onboard/route";
import { auth } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    block: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    report: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

interface MockNextRequest {
  json: () => Promise<any>;
}

function makeJsonRequest(body: any): MockNextRequest {
  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "content-type") {
          return "application/json";
        }
        return null;
      },
    } as any,
    json: async () => body,
  } as any;
}

describe("Safety & Moderation API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/user/block", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as any).mockResolvedValue(null);
      const req = makeJsonRequest({ blockedId: "target-user-1" });

      const res = await blockPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 if user tries to block themselves", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      const req = makeJsonRequest({ blockedId: "user-1" });

      const res = await blockPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("You cannot block yourself");
    });

    it("creates block successfully if target user exists and not blocked yet", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-2", name: "Target User" } as any);
      vi.mocked(prisma.block.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.block.create).mockResolvedValue({ id: "block-1", blockerId: "user-1", blockedId: "user-2" } as any);

      const req = makeJsonRequest({ blockedId: "user-2" });
      const res = await blockPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(prisma.block.create).toHaveBeenCalledWith({
        data: {
          blockerId: "user-1",
          blockedId: "user-2",
        },
      });
    });
  });

  describe("POST /api/user/report", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as any).mockResolvedValue(null);
      const req = makeJsonRequest({ reportedId: "user-2", reason: "Spam" });

      const res = await reportPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("creates report successfully if valid payload", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-2", name: "Target User" } as any);
      vi.mocked(prisma.report.create).mockResolvedValue({ id: "report-1" } as any);

      const req = makeJsonRequest({ reportedId: "user-2", reason: "Spam", details: "Fake account posting ads" });
      const res = await reportPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: "user-1",
          reportedId: "user-2",
          reason: "Spam",
          details: "Fake account posting ads",
        },
      });
    });
  });

  describe("POST /api/user/onboard", () => {
    it("completes onboarding successfully for authorized user", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1", onboarded: true } as any);

      const res = await onboardPOST({} as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { onboarded: true },
      });
    });
  });
});
