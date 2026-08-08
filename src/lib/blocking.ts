import prisma from "@/lib/prisma";

/**
 * Blocking is deliberately symmetric on this platform: once either side of a
 * pair has created a `Block` row, neither of them may reach the other. Only
 * checking `{ blockerId: me }` would let the person who was blocked keep
 * initiating contact, which is exactly the case a block is meant to stop.
 *
 * Everything in here works on a *set* of counterpart ids so a caller with a
 * whole conversation in hand still only pays for a single query.
 */

export interface BlockPairWhere {
  OR: Array<{
    blockerId: string | { in: string[] };
    blockedId: string | { in: string[] };
  }>;
}

function toIdList(
  otherUserIds: string | readonly string[],
): string[] {
  const list =
    typeof otherUserIds === "string"
      ? [otherUserIds]
      : Array.from(otherUserIds);

  // De-duplicate and drop empties so a stray "" can never widen the query.
  return Array.from(
    new Set(list.filter((id) => Boolean(id?.trim()))),
  );
}

/**
 * Prisma `where` fragment matching a block in *either* direction between
 * `userId` and any of `otherUserIds`.
 */
export function blockPairWhere(
  userId: string,
  otherUserIds: string | readonly string[],
): BlockPairWhere {
  const ids = toIdList(otherUserIds);

  return {
    OR: [
      { blockerId: userId, blockedId: { in: ids } },
      { blockerId: { in: ids }, blockedId: userId },
    ],
  };
}

/**
 * Returns the id of the first block found between `userId` and any of
 * `otherUserIds`, or `null` when the pair is clear.
 */
export async function findBlockBetween(
  userId: string,
  otherUserIds: string | readonly string[],
): Promise<{ id: string } | null> {
  const ids = toIdList(otherUserIds);

  if (ids.length === 0) {
    return null;
  }

  return prisma.block.findFirst({
    where: blockPairWhere(userId, ids),
    select: { id: true },
  });
}

/**
 * Convenience wrapper around {@link findBlockBetween} for the common
 * "may these two interact?" check.
 */
export async function isBlockedBetween(
  userId: string,
  otherUserIds: string | readonly string[],
): Promise<boolean> {
  return Boolean(await findBlockBetween(userId, otherUserIds));
}

/**
 * Every user id that `userId` may not interact with — the people they blocked
 * plus the people who blocked them. Useful for filtering list endpoints, where
 * a per-row check would mean N queries.
 */
export async function getBlockedUserIds(
  userId: string,
): Promise<string[]> {
  const blocks = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }],
    },
    select: { blockerId: true, blockedId: true },
  });

  const counterparts = blocks.map(
    (block: { blockerId: string; blockedId: string }) =>
      block.blockerId === userId
        ? block.blockedId
        : block.blockerId,
  );

  return Array.from(new Set(counterparts));
}
