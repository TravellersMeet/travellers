import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import { POST as onboardPOST } from "../onboard/route";
import { GET as profileGET, PATCH as profilePATCH } from "../profile/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

describe("Traveler Profiles & Onboarding Flow API Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/user/onboard", () => {
    it("completes onboarding with rich profile details", async () => {
      (auth as any).mockResolvedValue({ user: { id: "user-1" } });
      vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1", onboarded: true } as any);

      const payload = {
        name: "Alice",
        bio: "Travel lover",
        location: "Berlin",
        homeLocation: "Munich",
        languages: ["German", "English"],
        travelInterests: ["Nature", "Food"],
        accommodationPrefs: ["Hostels"],
        budgetRange: "Economy",
        socialLinks: ["https://instagram.com/alice"],
      };

      const req = makeJsonRequest(payload);
      const res = await onboardPOST(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          onboarded: true,
          name: "Alice",
          bio: "Travel lover",
          location: "Berlin",
          homeLocation: "Munich",
          languages: ["German", "English"],
          travelInterests: ["Nature", "Food"],
          accommodationPrefs: ["Hostels"],
          budgetRange: "Economy",
          socialLinks: ["https://instagram.com/alice"],
        },
      });
    });
  });

  describe("GET /api/user/profile", () => {
    it("returns profile with rich fields", async () => {
      (auth as any).mockResolvedValue({ user: { email: "alice@example.com" } });
      const mockProfile = {
        name: "Alice",
        email: "alice@example.com",
        bio: "Travel lover",
        location: "Berlin",
        image: null,
        homeLocation: "Munich",
        phone: null,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        languages: ["German", "English"],
        travelInterests: ["Nature", "Food"],
        accommodationPrefs: ["Hostels"],
        budgetRange: "Economy",
        socialLinks: ["https://instagram.com/alice"],
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockProfile as any);

      const res = await profileGET(
  new NextRequest(
    "http://localhost/api/user/profile",
  ),
);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.languages).toEqual(["German", "English"]);
      expect(data.budgetRange).toBe("Economy");
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "alice@example.com" },
        select: {
          name: true,
          email: true,
          bio: true,
          location: true,
          image: true,
          homeLocation: true,
          phone: true,
          emailVerified: true,
          createdAt: true,
          languages: true,
          travelInterests: true,
          accommodationPrefs: true,
          budgetRange: true,
          socialLinks: true,
          age: true,
          gender: true,
          travelStyle: true,
        },
      });
    });
  });

  describe("PATCH /api/user/profile", () => {
    it("updates rich profile details", async () => {
      (auth as any).mockResolvedValue({ user: { email: "alice@example.com" } });
      vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1" } as any);

      const patchPayload = {
        bio: "Updated bio",
        languages: ["English"],
        budgetRange: "Mid-range",
      };

      const req = makeJsonRequest(patchPayload);
      const res = await profilePATCH(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { email: "alice@example.com" },
        data: {
          bio: "Updated bio",
          languages: ["English"],
          budgetRange: "Mid-range",
          name: undefined,
          location: undefined,
          homeLocation: undefined,
          travelInterests: undefined,
          accommodationPrefs: undefined,
          socialLinks: undefined,
          age: undefined,
          gender: undefined,
          travelStyle: undefined,
        },
      });
    });
  });
});
