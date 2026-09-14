import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    meetupPlan: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
    route: {
      findFirst: vi.fn(),
    },
  },
}));

import { PATCH, DELETE } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

describe("PATCH & DELETE /api/meetup-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (body: any) => {
    return {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as any;
  };

  const createDeleteRequest = (id?: string) => {
    const url = new URL(
      id ? `http://localhost/api/meetup-plans?id=${id}` : "http://localhost/api/meetup-plans"
    );
    return {
      headers: new Headers(),
      nextUrl: url,
    } as any;
  };

  describe("PATCH /api/meetup-plans", () => {
    it("returns 401 if unauthorized", async () => {
      (auth as any).mockResolvedValue(null);

      const req = createRequest({ id: "plan-1", title: "Updated Meetup" });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 404 if plan not found in user's conversations", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.meetupPlan.findFirst as any).mockResolvedValue(null);

      const req = createRequest({ id: "plan-99", title: "Updated Meetup" });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Meetup plan not found");
    });

    it("updates plan fields successfully when user is a conversation member", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.meetupPlan.findFirst as any).mockResolvedValue({ id: "plan-1" });

      const updatedRecord = {
        id: "plan-1",
        title: "Sunset Meetup",
        locationName: "Baga Beach",
        meetupTime: new Date("2026-09-01T18:00:00Z"),
        checklist: [],
      };
      (prisma.meetupPlan.update as any).mockResolvedValue(updatedRecord);

      const req = createRequest({
        id: "plan-1",
        title: "Sunset Meetup",
        locationName: "Baga Beach",
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.title).toBe("Sunset Meetup");
      expect(prisma.meetupPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "plan-1" },
          data: expect.objectContaining({
            title: "Sunset Meetup",
            locationName: "Baga Beach",
          }),
        })
      );
    });
  });

  describe("DELETE /api/meetup-plans", () => {
    it("returns 400 if id param is missing", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });

      const req = createDeleteRequest();
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("id is required");
    });

    it("returns 404 if plan does not exist or user lacks access", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.meetupPlan.findFirst as any).mockResolvedValue(null);

      const req = createDeleteRequest("plan-999");
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Meetup plan not found");
    });

    it("deletes meetup plan successfully", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      (prisma.meetupPlan.findFirst as any).mockResolvedValue({ id: "plan-1" });
      (prisma.meetupPlan.delete as any).mockResolvedValue({ id: "plan-1" });

      const req = createDeleteRequest("plan-1");
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.meetupPlan.delete).toHaveBeenCalledWith({
        where: { id: "plan-1" },
      });
    });
  });
});
