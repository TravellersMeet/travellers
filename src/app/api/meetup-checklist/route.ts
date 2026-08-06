import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

// A checklist item belongs to a MeetupPlan, which belongs to a Conversation.
// A user may read/modify it only if they are a member of that conversation.
async function canAccessMeetupPlan(meetupPlanId: string, userId: string) {
  const plan = await prisma.meetupPlan.findFirst({
    where: {
      id: meetupPlanId,
      conversation: { users: { some: { id: userId } } },
    },
    select: { id: true },
  });
  return Boolean(plan);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const meetupPlanId = searchParams.get("meetupPlanId");

  if (!meetupPlanId) {
    return NextResponse.json([], { status: 200 });
  }

  if (!(await canAccessMeetupPlan(meetupPlanId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await prisma.meetupChecklistItem.findMany({
    where: {
      meetupPlanId,
    },
    orderBy: [
      { completed: "asc" },
      { createdAt: "asc" },
    ],
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (!body.meetupPlanId) {
    return NextResponse.json(
      { error: "meetupPlanId is required" },
      { status: 400 }
    );
  }

  if (!(await canAccessMeetupPlan(body.meetupPlanId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const item = await prisma.meetupChecklistItem.create({
    data: {
      meetupPlanId: body.meetupPlanId,
      text: body.text,
    },
  });

  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const existing = await prisma.meetupChecklistItem.findUnique({
    where: { id: body.id },
    select: { meetupPlanId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canAccessMeetupPlan(existing.meetupPlanId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const item = await prisma.meetupChecklistItem.update({
    where: {
      id: body.id,
    },
    data: {
      ...(body.completed !== undefined && {
        completed: body.completed,
      }),

      ...(body.text !== undefined && {
        text: body.text,
      }),
    },
  });

  return NextResponse.json(item);
}
