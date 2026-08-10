import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  DELETE,
  GET,
  MAX_CHECKLIST_ITEMS_PER_PLAN,
  MAX_CHECKLIST_TEXT_LENGTH,
  PATCH,
  POST,
} from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    meetupPlan: {
      findFirst: vi.fn(),
    },
    meetupChecklistItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

function jsonRequest(
  method: "POST" | "PATCH",
  body: unknown,
) {
  return new NextRequest(
    "http://localhost/api/meetup-checklist",
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function deleteRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/meetup-checklist${query}`,
    { method: "DELETE" },
  );
}

function grantPlanAccess() {
  vi.mocked(prisma.meetupPlan.findFirst).mockResolvedValue({
    id: "plan-1",
  } as never);
}

function denyPlanAccess() {
  vi.mocked(prisma.meetupPlan.findFirst).mockResolvedValue(
    null as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  grantPlanAccess();
  vi.mocked(prisma.meetupChecklistItem.count).mockResolvedValue(
    0 as never,
  );
  vi.mocked(prisma.meetupChecklistItem.create).mockResolvedValue({
    id: "item-1",
    meetupPlanId: "plan-1",
    text: "Book the hostel",
    completed: false,
  } as never);
  vi.mocked(prisma.meetupChecklistItem.update).mockResolvedValue({
    id: "item-1",
  } as never);
  vi.mocked(
    prisma.meetupChecklistItem.findUnique,
  ).mockResolvedValue({ meetupPlanId: "plan-1" } as never);
});

describe("POST /api/meetup-checklist", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "Book the hostel",
      }),
    );

    expect(response.status).toBe(401);
    expect(
      prisma.meetupChecklistItem.create,
    ).not.toHaveBeenCalled();
  });

  it("creates an item for a plan the caller belongs to", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "Book the hostel",
      }),
    );

    expect(response.status).toBe(201);
    expect(
      prisma.meetupChecklistItem.create,
    ).toHaveBeenCalledWith({
      data: {
        meetupPlanId: "plan-1",
        text: "Book the hostel",
      },
    });
  });

  it("trims the text before storing it", async () => {
    await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "   Carry the printout   ",
      }),
    );

    expect(
      prisma.meetupChecklistItem.create,
    ).toHaveBeenCalledWith({
      data: {
        meetupPlanId: "plan-1",
        text: "Carry the printout",
      },
    });
  });

  it("rejects an empty item with 400", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "",
      }),
    );

    expect(response.status).toBe(400);
    expect(
      prisma.meetupChecklistItem.create,
    ).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only text with 400", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "      ",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-string text with 400 rather than a Prisma 500", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: { nested: "object" },
      }),
    );

    expect(response.status).toBe(400);
    expect(
      prisma.meetupChecklistItem.create,
    ).not.toHaveBeenCalled();
  });

  it("rejects text past the length cap with 400", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "a".repeat(MAX_CHECKLIST_TEXT_LENGTH + 1),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts text exactly at the length cap", async () => {
    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "a".repeat(MAX_CHECKLIST_TEXT_LENGTH),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("rejects a missing meetupPlanId with 400", async () => {
    const response = await POST(
      jsonRequest("POST", { text: "Book the hostel" }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 403 for a plan the caller is not part of", async () => {
    denyPlanAccess();

    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "someone-elses-plan",
        text: "Book the hostel",
      }),
    );

    expect(response.status).toBe(403);
    expect(
      prisma.meetupChecklistItem.create,
    ).not.toHaveBeenCalled();
  });

  it("refuses to grow a checklist past the item cap", async () => {
    vi.mocked(
      prisma.meetupChecklistItem.count,
    ).mockResolvedValue(
      MAX_CHECKLIST_ITEMS_PER_PLAN as never,
    );

    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "One too many",
      }),
    );

    expect(response.status).toBe(409);
    expect(
      prisma.meetupChecklistItem.create,
    ).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    vi.mocked(
      prisma.meetupChecklistItem.create,
    ).mockRejectedValue(new Error("db down") as never);

    const response = await POST(
      jsonRequest("POST", {
        meetupPlanId: "plan-1",
        text: "Book the hostel",
      }),
    );

    expect(response.status).toBe(500);
  });
});

describe("PATCH /api/meetup-checklist", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1", completed: true }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 instead of 500 when id is missing", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { completed: true }),
    );

    expect(response.status).toBe(400);
    expect(
      prisma.meetupChecklistItem.findUnique,
    ).not.toHaveBeenCalled();
  });

  it("returns 400 when neither text nor completed is supplied", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1" }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects blanking an item's text", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1", text: "   " }),
    );

    expect(response.status).toBe(400);
    expect(
      prisma.meetupChecklistItem.update,
    ).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean completed flag", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1", completed: "yes" }),
    );

    expect(response.status).toBe(400);
  });

  it("toggles completion for an accessible item", async () => {
    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1", completed: true }),
    );

    expect(response.status).toBe(200);
    expect(
      prisma.meetupChecklistItem.update,
    ).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { completed: true },
    });
  });

  it("returns 404 for an item that does not exist", async () => {
    vi.mocked(
      prisma.meetupChecklistItem.findUnique,
    ).mockResolvedValue(null as never);

    const response = await PATCH(
      jsonRequest("PATCH", { id: "missing", completed: true }),
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for an item on another conversation's plan", async () => {
    denyPlanAccess();

    const response = await PATCH(
      jsonRequest("PATCH", { id: "item-1", completed: true }),
    );

    expect(response.status).toBe(403);
    expect(
      prisma.meetupChecklistItem.update,
    ).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/meetup-checklist", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await DELETE(
      deleteRequest("?id=item-1"),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 without an id", async () => {
    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(400);
    expect(
      prisma.meetupChecklistItem.delete,
    ).not.toHaveBeenCalled();
  });

  it("deletes an item on a plan the caller belongs to", async () => {
    const response = await DELETE(
      deleteRequest("?id=item-1"),
    );

    expect(response.status).toBe(200);
    expect(
      prisma.meetupChecklistItem.delete,
    ).toHaveBeenCalledWith({ where: { id: "item-1" } });
  });

  it("returns 404 for an item that does not exist", async () => {
    vi.mocked(
      prisma.meetupChecklistItem.findUnique,
    ).mockResolvedValue(null as never);

    const response = await DELETE(
      deleteRequest("?id=missing"),
    );

    expect(response.status).toBe(404);
    expect(
      prisma.meetupChecklistItem.delete,
    ).not.toHaveBeenCalled();
  });

  it("returns 403 for an item on another conversation's plan", async () => {
    denyPlanAccess();

    const response = await DELETE(
      deleteRequest("?id=item-1"),
    );

    expect(response.status).toBe(403);
    expect(
      prisma.meetupChecklistItem.delete,
    ).not.toHaveBeenCalled();
  });

  it("returns 500 when the delete fails", async () => {
    vi.mocked(
      prisma.meetupChecklistItem.delete,
    ).mockRejectedValue(new Error("db down") as never);

    const response = await DELETE(
      deleteRequest("?id=item-1"),
    );

    expect(response.status).toBe(500);
  });
});

describe("GET /api/meetup-checklist", () => {
  beforeEach(() => {
    vi.mocked(
      prisma.meetupChecklistItem.findMany,
    ).mockResolvedValue([] as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/meetup-checklist?meetupPlanId=plan-1",
      ),
    );

    expect(response.status).toBe(401);
  });

  it("bounds the query rather than returning the whole list", async () => {
    await GET(
      new NextRequest(
        "http://localhost/api/meetup-checklist?meetupPlanId=plan-1",
      ),
    );

    expect(
      prisma.meetupChecklistItem.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        take: MAX_CHECKLIST_ITEMS_PER_PLAN,
      }),
    );
  });

  it("returns 403 for a plan the caller is not part of", async () => {
    denyPlanAccess();

    const response = await GET(
      new NextRequest(
        "http://localhost/api/meetup-checklist?meetupPlanId=plan-1",
      ),
    );

    expect(response.status).toBe(403);
  });
});
