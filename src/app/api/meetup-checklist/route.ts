import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withValidation } from "@/lib/withValidation";

/**
 * Checklist items are one-line reminders ("book the hostel", "carry the
 * printout"), not notes. `text` is an unbounded String in the schema, so
 * without a cap a single item could carry megabytes that both travellers then
 * download on every load.
 */
export const MAX_CHECKLIST_TEXT_LENGTH = 200;

/**
 * Upper bound on items per plan. Nothing here is user-facing under normal use
 * — it exists so a script cannot grow one plan without limit, and so `GET`
 * has a number it can safely `take`.
 */
export const MAX_CHECKLIST_ITEMS_PER_PLAN = 200;

const checklistTextSchema = z
  .string({
    invalid_type_error: "Checklist text must be a string",
  })
  .trim()
  .min(1, "Checklist text is required")
  .max(
    MAX_CHECKLIST_TEXT_LENGTH,
    `Checklist text is too long (max ${MAX_CHECKLIST_TEXT_LENGTH} characters)`,
  );

const createItemSchema = z.object({
  meetupPlanId: z
    .string()
    .trim()
    .min(1, "meetupPlanId is required"),
  text: checklistTextSchema,
});

const updateItemSchema = z
  .object({
    id: z.string().trim().min(1, "id is required"),
    text: checklistTextSchema.optional(),
    completed: z
      .boolean({
        invalid_type_error: "completed must be a boolean",
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.completed !== undefined,
    {
      message:
        "Provide text, completed, or both",
      path: ["text"],
    },
  );

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

/**
 * Resolves the item and checks access in one place, so every verb that works
 * on an existing item applies the same rule.
 */
async function loadAccessibleItem(
  itemId: string,
  userId: string,
): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  const existing =
    await prisma.meetupChecklistItem.findUnique({
      where: { id: itemId },
      select: { meetupPlanId: true },
    });

  if (!existing) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not found" },
        { status: 404 },
      ),
    };
  }

  if (
    !(await canAccessMeetupPlan(
      existing.meetupPlanId,
      userId,
    ))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
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

  try {
    const items = await prisma.meetupChecklistItem.findMany({
      where: {
        meetupPlanId,
      },
      orderBy: [
        { completed: "asc" },
        { createdAt: "asc" },
      ],
      take: MAX_CHECKLIST_ITEMS_PER_PLAN,
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("Fetch checklist error:", error);

    return NextResponse.json(
      { error: "Failed to load checklist" },
      { status: 500 },
    );
  }
}

export const POST = withValidation(
  createItemSchema,
  async (_req, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (
      !(await canAccessMeetupPlan(
        data.meetupPlanId,
        session.user.id,
      ))
    ) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    try {
      const itemCount =
        await prisma.meetupChecklistItem.count({
          where: { meetupPlanId: data.meetupPlanId },
        });

      if (itemCount >= MAX_CHECKLIST_ITEMS_PER_PLAN) {
        return NextResponse.json(
          {
            error: `This checklist is full (max ${MAX_CHECKLIST_ITEMS_PER_PLAN} items)`,
          },
          { status: 409 },
        );
      }

      const item =
        await prisma.meetupChecklistItem.create({
          data: {
            meetupPlanId: data.meetupPlanId,
            text: data.text,
          },
        });

      return NextResponse.json(item, { status: 201 });
    } catch (error) {
      console.error(
        "Create checklist item error:",
        error,
      );

      return NextResponse.json(
        { error: "Failed to add checklist item" },
        { status: 500 },
      );
    }
  },
);

export const PATCH = withValidation(
  updateItemSchema,
  async (_req, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const access = await loadAccessibleItem(
      data.id,
      session.user.id,
    );

    if (!access.ok) {
      return access.response;
    }

    try {
      const item =
        await prisma.meetupChecklistItem.update({
          where: {
            id: data.id,
          },
          data: {
            ...(data.completed !== undefined && {
              completed: data.completed,
            }),

            ...(data.text !== undefined && {
              text: data.text,
            }),
          },
        });

      return NextResponse.json(item);
    } catch (error) {
      console.error(
        "Update checklist item error:",
        error,
      );

      return NextResponse.json(
        { error: "Failed to update checklist item" },
        { status: 500 },
      );
    }
  },
);

/**
 * DELETE /api/meetup-checklist?id=<itemId>
 *
 * Removes one item. Gated by the same conversation-membership rule as the
 * other verbs, so either traveller on the plan can tidy the shared list but
 * nobody outside it can touch it.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const itemId = new URL(req.url).searchParams.get("id");

  if (!itemId) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  const access = await loadAccessibleItem(
    itemId,
    session.user.id,
  );

  if (!access.ok) {
    return access.response;
  }

  try {
    await prisma.meetupChecklistItem.delete({
      where: { id: itemId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "Delete checklist item error:",
      error,
    );

    return NextResponse.json(
      { error: "Failed to delete checklist item" },
      { status: 500 },
    );
  }
}
