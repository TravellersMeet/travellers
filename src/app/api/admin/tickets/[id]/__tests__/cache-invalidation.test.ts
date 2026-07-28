import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";
import { PATCH } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/match-cache", () => ({
  invalidateMatchCachesForTicket: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

const existingTicket = {
  id: "ticket-1",
  destination: "Goa",
  departureDate: new Date(
    "2026-08-15T00:00:00.000Z",
  ),
  status: "PENDING",
};

const updatedTicket = {
  ...existingTicket,
  status: "VERIFIED",
  user: {
    id: "traveller-1",
    name: "Traveller",
    email: "traveller@example.com",
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({
    user: { id: "admin-1" },
  } as never);
  vi.mocked(
    prisma.user.findUnique,
  ).mockResolvedValue({
    role: "ADMIN",
  } as never);
  vi.mocked(
    prisma.ticket.findUnique,
  ).mockResolvedValue(
    existingTicket as never,
  );
  vi.mocked(
    prisma.ticket.update,
  ).mockResolvedValue(
    updatedTicket as never,
  );
});

describe("admin ticket cache invalidation", () => {
  it.each(["VERIFIED", "REJECTED"])(
    "invalidates matching windows when status becomes %s",
    async (status) => {
      vi.mocked(
        prisma.ticket.update,
      ).mockResolvedValue({
        ...updatedTicket,
        status,
      } as never);

      const response = await PATCH(
        new NextRequest(
          "http://localhost/api/admin/tickets/ticket-1",
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ status }),
          },
        ),
        {
          params: { id: "ticket-1" },
        },
      );

      expect(response.status).toBe(200);
      expect(
        invalidateMatchCachesForTicket,
      ).toHaveBeenCalledWith(
        {
          destination: "Goa",
          departureDate:
            existingTicket.departureDate,
        },
        {
          destination: "Goa",
          departureDate:
            existingTicket.departureDate,
        },
      );
      expect(
        createNotification,
      ).toHaveBeenCalledOnce();
    },
  );

  it("does not fail verification when invalidation fails safely", async () => {
    vi.mocked(
      invalidateMatchCachesForTicket,
    ).mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/admin/tickets/ticket-1",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            status: "VERIFIED",
          }),
        },
      ),
      {
        params: { id: "ticket-1" },
      },
    );

    expect(response.status).toBe(200);
  });
});
