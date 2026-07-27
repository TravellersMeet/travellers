import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const result = updateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Invalid status",
          details: result.error.flatten(),
        },
        { status: 400 }
      );
    }

    const existingTicket =
      await prisma.ticket.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          destination: true,
          departureDate: true,
          status: true,
        },
      });

    if (!existingTicket) {
      return NextResponse.json(
        { error: "Ticket not found" },
        { status: 404 }
      );
    }

    const { status } = result.data;

    const ticket = await prisma.ticket.update({
      where: { id: params.id },
      data: { status },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await invalidateMatchCachesForTicket(
      {
        destination: ticket.destination,
        departureDate: ticket.departureDate,
      },
      {
        destination: existingTicket.destination,
        departureDate:
          existingTicket.departureDate,
      }
    );

    if (status === "VERIFIED") {
      await createNotification({
        userId: ticket.user.id,
        type: "TICKET_VERIFIED",
        title: "Ticket verified",
        content:
          "Your travel ticket has been verified. You can now appear in traveller matches.",
        link: "/dashboard",
      });
    }

    if (status === "REJECTED") {
      await createNotification({
        userId: ticket.user.id,
        type: "TICKET_REJECTED",
        title: "Ticket rejected",
        content:
          "Your uploaded ticket was rejected. Please upload a valid ticket.",
        link: "/upload",
      });
    }

    return NextResponse.json({
      ok: true,
      ticket,
    });
  } catch (error) {
    console.error(
      "Ticket verification error:",
      error
    );
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: "Ticket not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("Get ticket error:", error);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
