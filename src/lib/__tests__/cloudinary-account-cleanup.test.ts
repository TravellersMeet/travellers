import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import cloudinary from "@/lib/cloudinary";
import {
  extractCloudinaryPublicId,
  processAssetCleanupJobs,
} from "@/lib/cloudinary-delete";
import prisma from "@/lib/prisma";

vi.mock("@/lib/cloudinary", () => ({
  default: {
    uploader: {
      destroy: vi.fn(),
    },
  },
  isCloudinaryConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    assetCleanupJob: {
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Cloudinary account cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts public IDs from versioned Cloudinary URLs", () => {
    expect(
      extractCloudinaryPublicId(
        "https://res.cloudinary.com/demo/image/upload/v123/travellers/tickets/file-name.pdf",
      ),
    ).toBe("travellers/tickets/file-name");
  });

  it("marks successful cleanup jobs complete", async () => {
    vi.mocked(
      prisma.assetCleanupJob.findMany,
    ).mockResolvedValue([
      {
        id: "job-1",
        publicId: "travellers/tickets/one",
        attempts: 0,
      },
    ] as never);
    vi.mocked(
      cloudinary.uploader.destroy,
    ).mockResolvedValue({
      result: "ok",
    } as never);
    vi.mocked(
      prisma.assetCleanupJob.count,
    ).mockResolvedValue(0);

    const result = await processAssetCleanupJobs(
      "user-1",
    );

    expect(result).toEqual({
      processed: 1,
      deleted: 1,
      pending: 0,
    });
    expect(
      prisma.assetCleanupJob.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "job-1",
        },
        data: expect.objectContaining({
          completedAt: expect.any(Date),
          lastError: null,
        }),
      }),
    );
  });

  it("keeps failed jobs pending without storing raw errors", async () => {
    vi.mocked(
      prisma.assetCleanupJob.findMany,
    ).mockResolvedValue([
      {
        id: "job-1",
        publicId: "travellers/tickets/one",
        attempts: 0,
      },
    ] as never);
    vi.mocked(
      cloudinary.uploader.destroy,
    ).mockRejectedValue(
      new Error("secret cloudinary details"),
    );
    vi.mocked(
      prisma.assetCleanupJob.count,
    ).mockResolvedValue(1);

    const result = await processAssetCleanupJobs(
      "user-1",
    );

    expect(result.pending).toBe(1);
    expect(
      prisma.assetCleanupJob.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError:
            "Cloudinary asset cleanup failed",
        }),
      }),
    );
  });
});
