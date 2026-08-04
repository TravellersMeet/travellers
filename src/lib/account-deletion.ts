import type { Prisma } from "@prisma/client";

import {
  extractCloudinaryPublicId,
  processAssetCleanupJobs,
} from "@/lib/cloudinary-delete";
import prisma from "@/lib/prisma";

export interface DeleteAccountResult {
  alreadyDeleted: boolean;
  queuedAssets: number;
  cleanup: {
    processed: number;
    deleted: number;
    pending: number;
  };
}

function uniquePublicIds(
  tickets: Array<{ ticketUrl: string }>,
): string[] {
  return Array.from(
    new Set(
      tickets
        .map(({ ticketUrl }) =>
          extractCloudinaryPublicId(ticketUrl),
        )
        .filter(
          (publicId): publicId is string =>
            publicId !== null,
        ),
    ),
  );
}

export async function deleteUserAccount(
  userId: string,
): Promise<DeleteAccountResult> {
  const databaseResult = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          tickets: {
            select: {
              ticketUrl: true,
            },
          },
          conversations: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!user) {
        return {
          alreadyDeleted: true,
          queuedAssets: 0,
        };
      }

      const publicIds = uniquePublicIds(user.tickets);
      const conversationIds = user.conversations.map(
        ({ id }) => id,
      );

      if (publicIds.length > 0) {
        await tx.assetCleanupJob.createMany({
          data: publicIds.map((publicId) => ({
            ownerId: userId,
            publicId,
          })),
          skipDuplicates: true,
        });
      }

      // Ticket.user currently has no database cascade rule.
      await tx.ticket.deleteMany({
        where: {
          userId,
        },
      });

      // User deletion cascades accounts, sessions, routes,
      // notifications, messages, requests, blocks, reports,
      // and creator-owned meetup plans.
      await tx.user.delete({
        where: {
          id: userId,
        },
      });

      if (conversationIds.length > 0) {
        await tx.conversation.deleteMany({
          where: {
            id: {
              in: conversationIds,
            },
            users: {
              none: {},
            },
            messages: {
              none: {},
            },
          },
        });
      }

      return {
        alreadyDeleted: false,
        queuedAssets: publicIds.length,
      };
    },
  );

  const cleanup = await processAssetCleanupJobs(userId);

  return {
    ...databaseResult,
    cleanup,
  };
}
