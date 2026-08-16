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

const UpdateMeetupPlanSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(120, "Title is too long (max 120 characters)")
    .optional(),
  locationName: z
    .string()
    .trim()
    .min(1, "Location cannot be empty")
    .max(200, "Location is too long (max 200 characters)")
    .optional(),
  meetupTime: z
    .string()
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      "meetupTime must be a valid date",
    )
    .optional(),
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
    .nullish(),
  routeId: z.string().min(1).nullish(),
});

const MEETUP_PLAN_INCLUDE = {
  checklist: true,
} as const;

/**
 * GET /api/meetup-plans
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

export const PATCH = withValidation(
  UpdateMeetupPlanSchema,
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
      const existing = await prisma.meetupPlan.findFirst({
        where: {
          id: data.id,
          conversation: {
            users: { some: { id: userId } },
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return NextResponse.json(
          { error: "Meetup plan not found" },
          { status: 404 },
        );
      }

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

      const updated = await prisma.meetupPlan.update({
        where: { id: data.id },
        data: {
          title: data.title,
          locationName: data.locationName,
          meetupTime: data.meetupTime
            ? new Date(data.meetupTime)
            : undefined,
          latitude: data.latitude,
          longitude: data.longitude,
          notes:
            data.notes !== undefined
              ? data.notes ?? null
              : undefined,
          routeId:
            data.routeId !== undefined
              ? data.routeId ?? null
              : undefined,
        },
        include: MEETUP_PLAN_INCLUDE,
      });

      return NextResponse.json(updated);
    } catch (error) {
      console.error("Update meetup plan error:", error);
      return NextResponse.json(
        { error: "Failed to update meetup plan" },
        { status: 500 },
      );
    }
  },
);

export async function DELETE(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.meetupPlan.findFirst({
      where: {
        id,
        conversation: {
          users: { some: { id: session.user.id } },
        },
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Meetup plan not found" },
        { status: 404 },
      );
    }

    await prisma.meetupPlan.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Meetup plan deleted successfully",
    });
  } catch (error) {
    console.error("Delete meetup plan error:", error);
    return NextResponse.json(
      { error: "Failed to delete meetup plan" },
      { status: 500 },
    );
  }
}
