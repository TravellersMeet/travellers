import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GET, POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    meetupPlan: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
    route: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function listRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/meetup-plans${query}`,
  );
}

function jsonRequest(body: unknown) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "application/json"
          : null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

const VALID_BODY = {
  conversationId: "conv-1",
  title: "Coffee before the bus",
  locationName: "Anjuna beach shack",
  meetupTime: "2026-09-01T09:00:00.000Z",
};

describe("GET /api/meetup-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(listRequest());

    expect(response.status).toBe(401);
  });

  it("returns the caller's plans as a list when no conversationId is given", async () => {
    vi.mocked(prisma.meetupPlan.findMany).mockResolvedValue([
      { id: "plan-1" },
    ] as never);

    const response = await GET(listRequest());
    const body = await response.json();

    expect(body).toEqual([{ id: "plan-1" }]);
    expect(prisma.meetupPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversation: {
            users: { some: { id: "user-1" } },
          },
        },
      }),
    );
  });

  it("scopes a single-conversation read to the caller's membership", async () => {
    vi.mocked(prisma.meetupPlan.findFirst).mockResolvedValue({
      id: "plan-1",
    } as never);

    const response = await GET(
      listRequest("?conversationId=conv-1"),
    );
    const body = await response.json();

    expect(body.id).toBe("plan-1");
    expect(prisma.meetupPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: "conv-1",
          conversation: {
            users: { some: { id: "user-1" } },
          },
        },
      }),
    );
  });
});

describe("POST /api/meetup-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
      id: "conv-1",
    } as never);
    vi.mocked(prisma.meetupPlan.findFirst).mockResolvedValue(
      null as never,
    );
    vi.mocked(prisma.meetupPlan.create).mockResolvedValue({
      id: "plan-1",
    } as never);
  });

  it("returns 400 instead of crashing on an unparseable meetupTime", async () => {
    const response = await POST(
      jsonRequest({
        ...VALID_BODY,
        meetupTime: "not a date",
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("returns 400 when meetupTime is missing", async () => {
    const { meetupTime, ...withoutTime } = VALID_BODY;

    const response = await POST(jsonRequest(withoutTime));

    expect(response.status).toBe(400);
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("rejects a meetup dated well into the past", async () => {
    const response = await POST(
      jsonRequest({
        ...VALID_BODY,
        meetupTime: "2019-01-01T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    const response = await POST(
      jsonRequest({ ...VALID_BODY, title: "   " }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects out-of-range coordinates", async () => {
    const response = await POST(
      jsonRequest({
        ...VALID_BODY,
        latitude: 120,
        longitude: 0,
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("persists the coordinates it was given", async () => {
    await POST(
      jsonRequest({
        ...VALID_BODY,
        latitude: 15.5874,
        longitude: 73.7405,
      }),
    );

    expect(prisma.meetupPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latitude: 15.5874,
          longitude: 73.7405,
        }),
      }),
    );
  });

  it("falls back to 0/0 when no point has been picked yet", async () => {
    await POST(jsonRequest(VALID_BODY));

    expect(prisma.meetupPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latitude: 0,
          longitude: 0,
        }),
      }),
    );
  });

  it("returns 403 for a conversation the caller is not in", async () => {
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await POST(jsonRequest(VALID_BODY));

    expect(response.status).toBe(403);
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("returns 403 when the attached route belongs to somebody else", async () => {
    vi.mocked(prisma.route.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await POST(
      jsonRequest({ ...VALID_BODY, routeId: "route-9" }),
    );

    expect(response.status).toBe(403);
    expect(prisma.route.findFirst).toHaveBeenCalledWith({
      where: { id: "route-9", userId: "user-1" },
      select: { id: true },
    });
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("accepts a route the caller owns", async () => {
    vi.mocked(prisma.route.findFirst).mockResolvedValue({
      id: "route-1",
    } as never);

    const response = await POST(
      jsonRequest({ ...VALID_BODY, routeId: "route-1" }),
    );

    expect(response.status).toBe(201);
    expect(prisma.meetupPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routeId: "route-1",
        }),
      }),
    );
  });

  it("returns 409 with the existing id rather than a second plan", async () => {
    vi.mocked(prisma.meetupPlan.findFirst).mockResolvedValue({
      id: "plan-existing",
    } as never);

    const response = await POST(jsonRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.meetupPlanId).toBe("plan-existing");
    expect(prisma.meetupPlan.create).not.toHaveBeenCalled();
  });

  it("creates the plan with the caller as creator", async () => {
    const response = await POST(jsonRequest(VALID_BODY));

    expect(response.status).toBe(201);
    expect(prisma.meetupPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          creatorId: "user-1",
          title: "Coffee before the bus",
          locationName: "Anjuna beach shack",
          meetupTime: new Date(
            "2026-09-01T09:00:00.000Z",
          ),
        }),
      }),
    );
  });
});
