import { TicketStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GET as getAdminTickets } from "../../admin/tickets/route";
import { GET as getUserTickets } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
    },
  },
}));

describe("ticket pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as never);
    vi.mocked(prisma.ticket.findMany).mockResolvedValue(
      [] as never,
    );
  });

  it("paginates authenticated user tickets", async () => {
    const response = await getUserTickets(
      new NextRequest(
        "http://localhost/api/tickets?limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pagination).toEqual({
      limit: 10,
      nextCursor: null,
      hasMore: false,
    });
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
        },
        take: 11,
      }),
    );
  });

  it("validates admin ticket statuses", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
    } as never);

    const response = await getAdminTickets(
      new NextRequest(
        "http://localhost/api/admin/tickets?status=INVALID",
      ),
    );

    expect(response.status).toBe(400);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it("applies a valid admin status without unsafe any filtering", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
    } as never);

    const response = await getAdminTickets(
      new NextRequest(
        `http://localhost/api/admin/tickets?status=${TicketStatus.PENDING}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: TicketStatus.PENDING,
        },
      }),
    );
  });
});
