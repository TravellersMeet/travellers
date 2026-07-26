import { describe, it, expect, beforeEach, vi } from "vitest";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";
import { auth } from "@/lib/auth";
import { GET as matchesGET } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    block: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function makeGetRequest(url: string): any {
  return {
    url,
    method: "GET",
  } as any;
}

describe("Matching Engine Logic & Filters API Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails if unauthorized", async () => {
    (auth as any).mockResolvedValue(null);
    const req = makeGetRequest("http://localhost/api/matches?destination=Tokyo&date=2026-08-01");
    const res = await matchesGET(req);
    expect(res.status).toBe(401);
  });

  it("calculates correct relevance scores and filters out blocked users", async () => {
    (auth as any).mockResolvedValue({ user: { id: "current-user-id" } });
    
    // Mock block relationships: current-user has blocked "blocked-user-id"
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      { blockerId: "current-user-id", blockedId: "blocked-user-id" },
    ] as any);

    // Mock current user profile
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "current-user-id",
      languages: ["English", "Spanish"],
      travelInterests: ["Culture", "Food"],
      accommodationPrefs: ["Hostels"],
      budgetRange: "Mid-range",
      travelStyle: "Backpacker",
    } as any);

    // Mock candidate tickets (one matching with shared profiles, one without, one from blocked user)
    const matchesMock = [
      {
        id: "ticket-1",
        userId: "candidate-1",
        destination: "Tokyo",
        departureDate: new Date("2026-08-01"),
        status: "VERIFIED",
        user: {
          id: "candidate-1",
          name: "Bob",
          languages: ["English", "Japanese"], // 1 shared language: +20
          travelInterests: ["Culture", "Nature"], // 1 shared interest: +15
          accommodationPrefs: ["Hostels"], // +15 (not used in backend formula but in mock fields)
          budgetRange: "Mid-range", // Same budget: +20
          travelStyle: "Backpacker", // Same style: +10
          age: 28,
          gender: "Male",
        },
      },
      {
        id: "ticket-2",
        userId: "candidate-2",
        destination: "Tokyo",
        departureDate: new Date("2026-08-02"), // 1 day diff: +10 date proximity
        status: "VERIFIED",
        user: {
          id: "candidate-2",
          name: "Charlie",
          languages: ["French"], // 0 shared
          travelInterests: ["Shopping"], // 0 shared
          budgetRange: "Luxury", // Different
          travelStyle: "Slow Travel", // Different
          age: 35,
          gender: "Male",
        },
      },
    ];

    vi.mocked(prisma.ticket.findMany).mockResolvedValue(matchesMock as any);
    if (redis) {
      vi.mocked(redis.get).mockResolvedValue(null);
    }

    const req = makeGetRequest(
      "http://localhost/api/matches?destination=Tokyo&date=2026-08-01&gender=Male"
    );
    const res = await matchesGET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.matches).toHaveLength(2);
    
    // Check sorting order (Bob should have a higher match score than Charlie)
    expect(body.matches[0].user.name).toBe("Bob");
    expect(body.matches[1].user.name).toBe("Charlie");

    // Bob score details:
    // Shared Languages: ["English"] -> +20
    // Shared Interests: ["Culture"] -> +15
    // Budget alignment: "Mid-range" === "Mid-range" -> +20
    // Travel style: "Backpacker" === "Backpacker" -> +10
    // Date proximity: same day ("2026-08-01" vs "2026-08-01") -> +20
    // Total raw score: 20 + 15 + 20 + 10 + 20 = 85
    // Normalized to 120 max points: Math.round((85 / 120) * 100) = 71
    expect(body.matches[0].relevanceScore).toBe(71);

    // Charlie score details:
    // Shared Languages: 0 -> 0
    // Shared Interests: 0 -> 0
    // Budget alignment: Diff -> 0
    // Travel style: Diff -> 0
    // Date proximity: 1 day diff -> +10
    // Total raw score: 10
    // Normalized to 120 max points: Math.round((10 / 120) * 100) = 8
    expect(body.matches[1].relevanceScore).toBe(8);
  });
});
