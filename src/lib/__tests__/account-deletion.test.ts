import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { deleteUserAccount } from "@/lib/account-deletion";
import {
  extractCloudinaryPublicId,
  processAssetCleanupJobs,
} from "@/lib/cloudinary-delete";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import prisma from "@/lib/prisma";

vi.mock("@/lib/cloudinary-delete", () => ({
  extractCloudinaryPublicId: vi.fn(),
  processAssetCleanupJobs: vi.fn(),
}));

vi.mock("@/lib/match-cache", () => ({
  invalidateMatchCachesForTicket: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
  },
}));

function createTransactionMock() {
  return {
    user: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    ticket: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversation: {
      deleteMany: vi.fn(),
    },
    assetCleanupJob: {
      createMany: vi.fn(),
    },
  };
}

describe("deleteUserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processAssetCleanupJobs).mockResolvedValue({
      processed: 0,
      deleted: 0,
      pending: 0,
    });
  });

  it("deletes user data transactionally and queues ticket assets", async () => {
    const tx = createTransactionMock();

    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      tickets: [
        {
          ticketUrl:
            "https://res.cloudinary.com/demo/image/upload/v1/travellers/tickets/one.png",
        },
      ],
      conversations: [
        {
          id: "conversation-1",
        },
      ],
    });

    tx.ticket.findMany.mockResolvedValue([
      {
        destination: "Goa",
        departureDate: new Date("2026-08-15T00:00:00.000Z"),
      },
    ]);

    vi.mocked(extractCloudinaryPublicId).mockReturnValue(
      "travellers/tickets/one",
    );

    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: any) => callback(tx),
    );

    vi.mocked(processAssetCleanupJobs).mockResolvedValue({
      processed: 1,
      deleted: 1,
      pending: 0,
    });

    const result = await deleteUserAccount("user-1");

    expect(tx.assetCleanupJob.createMany).toHaveBeenCalledWith({
      data: [
        {
          ownerId: "user-1",
          publicId: "travellers/tickets/one",
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.ticket.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
      },
      select: {
        destination: true,
        departureDate: true,
      },
    });
    expect(tx.ticket.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
      },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({
      where: {
        id: "user-1",
      },
    });
    expect(invalidateMatchCachesForTicket).toHaveBeenCalledWith({
      destination: "Goa",
      departureDate: new Date("2026-08-15T00:00:00.000Z"),
    });
    expect(result.cleanup.pending).toBe(0);
    expect(result.ticketsInvalidated).toBe(1);
  });

  it("is safe when the user was already deleted", async () => {
    const tx = createTransactionMock();
    tx.user.findUnique.mockResolvedValue(null);

    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: any) => callback(tx),
    );

    await expect(
      deleteUserAccount("user-1"),
    ).resolves.toMatchObject({
      alreadyDeleted: true,
      queuedAssets: 0,
      ticketsInvalidated: 0,
    });

    expect(tx.user.delete).not.toHaveBeenCalled();
    expect(processAssetCleanupJobs).toHaveBeenCalledWith(
      "user-1",
    );
    expect(invalidateMatchCachesForTicket).not.toHaveBeenCalled();
  });

  it("does not run external cleanup after transaction failure", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Error("database failure"),
    );

    await expect(
      deleteUserAccount("user-1"),
    ).rejects.toThrow("database failure");

    expect(
      processAssetCleanupJobs,
    ).not.toHaveBeenCalled();
    expect(invalidateMatchCachesForTicket).not.toHaveBeenCalled();
  });

  it("does not fail when cache invalidation fails", async () => {
    const tx = createTransactionMock();

    tx.user.findUnique.mockResolvedValue({
      id: "user-1",
      tickets: [
        {
          ticketUrl:
            "https://res.cloudinary.com/demo/image/upload/v1/travellers/tickets/one.png",
        },
      ],
      conversations: [],
    });

    tx.ticket.findMany.mockResolvedValue([
      {
        destination: "Goa",
        departureDate: new Date("2026-08-15T00:00:00.000Z"),
      },
    ]);

    vi.mocked(extractCloudinaryPublicId).mockReturnValue(
      "travellers/tickets/one",
    );

    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: any) => callback(tx),
    );

    vi.mocked(processAssetCleanupJobs).mockResolvedValue({
      processed: 1,
      deleted: 1,
      pending: 0,
    });

    vi.mocked(invalidateMatchCachesForTicket).mockRejectedValue(
      new Error("Redis connection failed"),
    );

    const result = await deleteUserAccount("user-1");

    // Should still succeed even if cache invalidation fails
    expect(result.ticketsInvalidated).toBe(1);
    expect(result.alreadyDeleted).toBe(false);
  });
});
