import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
console.log(prisma);

console.log("Prisma keys:", Object.keys(prisma));
console.log("Meetup model:", (prisma as any).meetupPlan);

export async function GET(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json([], { status: 401 });
  }

  const conversationId =
    req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json([]);
  }

  // Only return the plan if the caller is a member of its conversation,
  // otherwise any authenticated user could read another conversation's plan
  // by guessing the conversationId.
  const plan = await prisma.meetupPlan.findFirst({
    where: {
      conversationId,
      conversation: {
        users: { some: { id: session.user.id } },
      },
    },
    include: {
      checklist: true,
    },
  });

  return NextResponse.json(plan);
}

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json();

  const {
    conversationId,
    title,
    locationName,
    meetupTime,
    notes,
    routeId,
  } = body;

  // The caller must belong to the conversation they're creating a plan in,
  // otherwise they could attach a meetup plan to any conversation.
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      users: { some: { id: session.user.id } },
    },
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const meetup = await prisma.meetupPlan.create({
  data: {
    conversationId,

    creatorId: session.user.id,

    title,

    locationName,

    latitude: 0,

    longitude: 0,

    meetupTime: new Date(meetupTime),

    notes,

    routeId,
  },
});

  return NextResponse.json(meetup);
}