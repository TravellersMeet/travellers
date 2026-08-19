import type { Prisma } from "@prisma/client";

import {
  extractCloudinaryPublicId,
  processAssetCleanupJobs,
} from "@/lib/cloudinary-delete";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import prisma from "@/lib/prisma";

export interface DeleteAccountResult {
  alreadyDeleted: boolean;
  queuedAssets: number;
  cleanup: {
    processed: number;
    deleted: number;
    pending: number;
  };
  ticketsInvalidated: number;
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
    async (tx: Prisma.TransactionClient): Promise<{
      alreadyDeleted: boolean;
      queuedAssets: number;
      tickets: Array<{
        destination: string;
        departureDate: Date;
      }>;
    }> => {
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
          tickets: [],
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

      // Fetch tickets for cache invalidation before deletion
      const tickets = await tx.ticket.findMany({
        where: {
          userId,
        },
        select: {
          destination: true,
          departureDate: true,
        },
      });

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
        tickets,
      } as {
        alreadyDeleted: boolean;
        queuedAssets: number;
        tickets: Array<{
          destination: string;
          departureDate: Date;
        }>;
      };
    },
  );

  const cleanup = await processAssetCleanupJobs(userId);

  // Invalidate match caches for deleted tickets (outside transaction)
  const ticketsInvalidated = databaseResult.tickets?.length || 0;
  for (const ticket of databaseResult.tickets || []) {
    try {
      await invalidateMatchCachesForTicket({
        destination: ticket.destination,
        departureDate: ticket.departureDate,
      });
    } catch (error) {
      console.error(
        "Failed to invalidate match cache for deleted ticket:",
        error,
      );
    }
  }

  return {
    ...databaseResult,
    cleanup,
    ticketsInvalidated,
  } as DeleteAccountResult;
}
