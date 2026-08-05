import cloudinary, {
  isCloudinaryConfigured,
} from "@/lib/cloudinary";
import prisma from "@/lib/prisma";

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export interface CleanupJobSummary {
  processed: number;
  deleted: number;
  pending: number;
}

export function extractCloudinaryPublicId(
  assetUrl: string,
): string | null {
  try {
    const url = new URL(assetUrl);
    const uploadMarker = "/upload/";
    const uploadIndex = url.pathname.indexOf(uploadMarker);

    if (uploadIndex === -1) {
      return null;
    }

    let assetPath = url.pathname.slice(
      uploadIndex + uploadMarker.length,
    );

    assetPath = assetPath.replace(/^v\d+\//, "");
    assetPath = decodeURIComponent(assetPath);
    assetPath = assetPath.replace(/\.[^/.]+$/, "");

    const publicId = assetPath.replace(/^\/+|\/+$/g, "");
    return publicId || null;
  } catch {
    return null;
  }
}

export async function deleteCloudinaryAsset(
  publicId: string,
): Promise<void> {
  if (!publicId.trim()) {
    return;
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured.");
  }

  await cloudinary.uploader.destroy(publicId, {
    resource_type: "auto",
    invalidate: true,
  });
}

export async function processAssetCleanupJobs(
  ownerId: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<CleanupJobSummary> {
  const now = new Date();
  const jobs = await prisma.assetCleanupJob.findMany({
    where: {
      ownerId,
      completedAt: null,
      attempts: {
        lt: maxAttempts,
      },
      OR: [
        {
          nextAttemptAt: null,
        },
        {
          nextAttemptAt: {
            lte: now,
          },
        },
      ],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  let deleted = 0;

  for (const job of jobs) {
    try {
      await deleteCloudinaryAsset(job.publicId);

      await prisma.assetCleanupJob.update({
        where: {
          id: job.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          completedAt: new Date(),
          lastError: null,
          nextAttemptAt: null,
        },
      });

      deleted += 1;
    } catch {
      const nextAttempt = job.attempts + 1;

      await prisma.assetCleanupJob.update({
        where: {
          id: job.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          lastError: "Cloudinary asset cleanup failed",
          nextAttemptAt:
            nextAttempt < maxAttempts
              ? new Date(Date.now() + RETRY_DELAY_MS)
              : null,
        },
      });
    }
  }

  const pending = await prisma.assetCleanupJob.count({
    where: {
      ownerId,
      completedAt: null,
    },
  });

  return {
    processed: jobs.length,
    deleted,
    pending,
  };
}
