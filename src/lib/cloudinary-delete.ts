import cloudinary, {
  isCloudinaryConfigured,
} from "@/lib/cloudinary";

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
