import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/cloudinary-upload", () => ({
  uploadFileToCloudinary: vi.fn(),
}));

vi.mock("@/lib/cloudinary-delete", () => ({
  extractCloudinaryPublicId: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
}));

import { POST } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadFileToCloudinary } from "@/lib/cloudinary-upload";
import {
  extractCloudinaryPublicId,
  deleteCloudinaryAsset,
} from "@/lib/cloudinary-delete";

describe("POST /api/user/avatar - old asset cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createFormDataRequest = (file: any) => {
    const formData = new Map();
    if (file) formData.set("file", file);

    return {
      headers: new Headers(),
      formData: async () => formData,
    } as any;
  };

  it("deletes previous Cloudinary avatar asset when uploading a new avatar", async () => {
    (auth as any).mockResolvedValue({
      user: { email: "user@example.com" },
    });

    const oldAvatarUrl =
      "https://res.cloudinary.com/demo/image/upload/v12345/travellers/avatars/old_avatar.jpg";
    const newAvatarUrl =
      "https://res.cloudinary.com/demo/image/upload/v67890/travellers/avatars/new_avatar.jpg";

    (prisma.user.findUnique as any).mockResolvedValue({
      id: "user-1",
      image: oldAvatarUrl,
    });

    (uploadFileToCloudinary as any).mockResolvedValue({
      url: newAvatarUrl,
      publicId: "travellers/avatars/new_avatar",
    });

    (prisma.user.update as any).mockResolvedValue({
      id: "user-1",
      image: newAvatarUrl,
    });

    (extractCloudinaryPublicId as any).mockReturnValue(
      "travellers/avatars/old_avatar",
    );
    (deleteCloudinaryAsset as any).mockResolvedValue(undefined);

    const file = new File(["dummy content"], "avatar.jpg", {
      type: "image/jpeg",
    });
    const req = createFormDataRequest(file);

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.image).toBe(newAvatarUrl);

    expect(extractCloudinaryPublicId).toHaveBeenCalledWith(oldAvatarUrl);
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith(
      "travellers/avatars/old_avatar",
    );
  });
});
