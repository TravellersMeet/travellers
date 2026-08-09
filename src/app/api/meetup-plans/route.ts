import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withValidation } from "@/lib/withValidation";

/**
 * A plan created from the chat starts as a placeholder ("New Meetup" at the
 * current time), so a strict "must be in the future" rule would reject the
 * app's own request. This guards against the case that actually matters —
 * a mistyped year landing the meetup in the distant past.
 */
const MAX_MEETUP_BACKDATE_MS = 24 * 60 * 60 * 1000;

const MeetupPlanSchema = z.object({
  conversationId: z
    .string()
    .trim()
    .min(1, "conversationId is required"),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(120, "Title is too long (max 120 characters)"),
  locationName: z
    .string()
    .trim()
    .min(1, "Location is required")
    .max(200, "Location is too long (max 200 characters)"),
  meetupTime: z
    .string()
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "meetupTime must be a valid date",
    )
    .refine(
      (value) =>
        new Date(value).getTime() >
        Date.now() - MAX_MEETUP_BACKDATE_MS,
      "meetupTime cannot be more than a day in the past",
    ),
  // Optional until the user picks a point on the map. Previously these were
  // hardcoded to 0, so every plan was stored at Null Island.
  latitude: z
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90")
    .optional(),
  longitude: z
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180")
    .optional(),
  notes: z
    .string()
    .max(2000, "Notes are too long (max 2000 characters)")
    .optional(),
  routeId: z.string().min(1).nullish(),
});

const MEETUP_PLAN_INCLUDE = {
  checklist: true,
} as const;

/**
 * GET /api/meetup-plans
 *
 * With `conversationId`: the single plan for that conversation, or `null`.
 * Without it: every plan in the caller's conversations, as an array.
 *
 * The two shapes exist because both callers already depend on them — the chat
 * panel reads a single plan, and the meetup dashboard reads a list. The
 * list case used to return `[]` unconditionally, so the dashboard could never
 * show a plan at all.
 */
export async function GET(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const conversationId =
    req.nextUrl.searchParams.get("conversationId");

  try {
    // Only return a plan if the caller is a member of its conversation,
    // otherwise any authenticated user could read another conversation's plan
    // by guessing the conversationId.
    if (conversationId) {
      const plan = await prisma.meetupPlan.findFirst({
        where: {
          conversationId,
          conversation: {
            users: { some: { id: session.user.id } },
          },
        },
        include: MEETUP_PLAN_INCLUDE,
      });

      return NextResponse.json(plan);
    }

    const plans = await prisma.meetupPlan.findMany({
      where: {
        conversation: {
          users: { some: { id: session.user.id } },
        },
      },
      include: MEETUP_PLAN_INCLUDE,
      orderBy: { meetupTime: "asc" },
    });

    return NextResponse.json(plans);
  } catch (error) {
    console.error("Fetch meetup plans error:", error);
    return NextResponse.json(
      { error: "Failed to load meetup plans" },
      { status: 500 },
    );
  }
}

export const POST = withValidation(
  MeetupPlanSchema,
  async (_req, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    try {
      // The caller must belong to the conversation they're creating a plan in,
      // otherwise they could attach a meetup plan to any conversation.
      const conversation =
        await prisma.conversation.findFirst({
          where: {
            id: data.conversationId,
            users: { some: { id: userId } },
          },
          select: { id: true },
        });

      if (!conversation) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 },
        );
      }

      // A shared route must belong to the creator, the same rule POST
      // /api/messages applies — otherwise a member could attach (and expose)
      // another user's route by passing its id.
      if (data.routeId) {
        const route = await prisma.route.findFirst({
          where: { id: data.routeId, userId },
          select: { id: true },
        });

        if (!route) {
          return NextResponse.json(
            {
              error: "Route not found or not owned by you",
            },
            { status: 403 },
          );
        }
      }

      // GET reads the conversation's plan with findFirst, so a second plan
      // would be silently unreachable. Say so instead of creating it.
      const existing = await prisma.meetupPlan.findFirst({
        where: { conversationId: data.conversationId },
        select: { id: true },
      });

      if (existing) {
        return NextResponse.json(
          {
            error:
              "This conversation already has a meetup plan",
            meetupPlanId: existing.id,
          },
          { status: 409 },
        );
      }

      const meetup = await prisma.meetupPlan.create({
        data: {
          conversationId: data.conversationId,
          creatorId: userId,
          title: data.title,
          locationName: data.locationName,
          latitude: data.latitude ?? 0,
          longitude: data.longitude ?? 0,
          meetupTime: new Date(data.meetupTime),
          notes: data.notes ?? null,
          routeId: data.routeId ?? null,
        },
        include: MEETUP_PLAN_INCLUDE,
      });

      return NextResponse.json(meetup, { status: 201 });
    } catch (error) {
      console.error("Create meetup plan error:", error);
      return NextResponse.json(
        { error: "Failed to create meetup plan" },
        { status: 500 },
      );
    }
  },
);
