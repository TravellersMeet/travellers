import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadFileToCloudinary } from "@/lib/cloudinary-upload";
import {
  deleteCloudinaryAsset,
  extractCloudinaryPublicId,
} from "@/lib/cloudinary-delete";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, or WebP image." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 2MB." },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, image: true },
    });

    const uploaded = await uploadFileToCloudinary(
      file,
      "travellers/avatars"
    );

    const updatedUser = await prisma.user.update({
      where: {
        email: session.user.email,
      },
      data: {
        image: uploaded.url,
      },
    });

    if (existingUser?.image && existingUser.image !== uploaded.url) {
      const oldPublicId = extractCloudinaryPublicId(existingUser.image);
      if (oldPublicId) {
        try {
          await deleteCloudinaryAsset(oldPublicId);
        } catch (cleanupError) {
          console.error(
            "Failed to delete previous avatar asset from Cloudinary:",
            cleanupError
          );
        }
      }
    }

    return NextResponse.json({ ok: true, image: updatedUser.image });
  } catch (error) {
    console.error("Avatar upload error:", error);
    return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
  }
}