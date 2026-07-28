import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const meetupPlanId = searchParams.get("meetupPlanId");

  if (!meetupPlanId) {
    return NextResponse.json([], { status: 200 });
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
  const body = await req.json();

  const item = await prisma.meetupChecklistItem.create({
    data: {
      meetupPlanId: body.meetupPlanId,
      text: body.text,
    },
  });

  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

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