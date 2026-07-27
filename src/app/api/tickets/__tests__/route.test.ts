import { TicketStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { deleteCloudinaryAsset } from "@/lib/cloudinary-delete";
import { uploadFileToCloudinary } from "@/lib/cloudinary-upload";
import {
  claimIdempotencyKey,
  releaseIdempotencyClaim,
  storeIdempotencyResult,
} from "@/lib/idempotency";
import prisma from "@/lib/prisma";
import { POST } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    ticket: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/cloudinary-upload", () => ({
  uploadFileToCloudinary: vi.fn(),
}));

vi.mock("@/lib/cloudinary-delete", () => ({
  deleteCloudinaryAsset: vi.fn(),
}));

vi.mock("@/lib/idempotency", () => ({
  claimIdempotencyKey: vi.fn(),
  storeIdempotencyResult: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}));

class MockFile extends Blob {
  name: string;
  lastModified: number;

  constructor(
    chunks: BlobPart[],
    name: string,
    options?: BlobPropertyBag,
  ) {
    super(chunks, options);
    this.name = name;
    this.lastModified = Date.now();
  }
}

const file = new MockFile(
  ["ticket"],
  "ticket.pdf",
  {
    type: "application/pdf",
  },
) as File;

function request(
  values: {
    destination?: string;
    departureDate?: string;
    file?: File;
  },
  idempotencyKey?: string,
) {
  const form = new FormData();

  if (values.destination) {
    form.append(
      "destination",
      values.destination,
    );
  }
  if (values.departureDate) {
    form.append(
      "departureDate",
      values.departureDate,
    );
  }
  if (values.file) {
    form.append("file", values.file);
  }

  return {
    headers: {
      get(name: string) {
        if (
          name.toLowerCase() ===
          "content-type"
        ) {
          return "multipart/form-data";
        }

        if (
          name.toLowerCase() ===
          "idempotency-key"
        ) {
          return idempotencyKey ?? null;
        }

        return null;
      },
    },
    formData: async () => form,
  };
}

const validInput = {
  destination: "New Delhi",
  departureDate: "2026-08-15",
  file,
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);

  vi.mocked(
    claimIdempotencyKey,
  ).mockResolvedValue({
    state: "disabled",
  });

  vi.mocked(
    prisma.ticket.findMany,
  ).mockResolvedValue([] as never);

  vi.mocked(
    uploadFileToCloudinary,
  ).mockResolvedValue({
    url: "https://example.com/ticket.pdf",
    publicId: "travellers/tickets/ticket-1",
  });

  vi.mocked(
    prisma.ticket.create,
  ).mockResolvedValue({
    id: "ticket-1",
    userId: "user-1",
    destination: "New Delhi",
    departureDate: new Date(
      "2026-08-15T00:00:00.000Z",
    ),
    ticketUrl:
      "https://example.com/ticket.pdf",
    status: TicketStatus.PENDING,
  } as never);
});

describe("POST /api/tickets", () => {
  it("rejects an existing pending or verified ticket before upload", async () => {
    vi.mocked(
      prisma.ticket.findMany,
    ).mockResolvedValue([
      {
        id: "existing-ticket",
        destination: "  NEW   DELHI ",
      },
    ] as never);

    const response = await POST(
      request(validInput) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error:
        "A ticket for this destination and departure date already exists",
      ticketId: "existing-ticket",
    });
    expect(
      uploadFileToCloudinary,
    ).not.toHaveBeenCalled();
  });

  it("allows another user to submit the same destination and date", async () => {
    await POST(request(validInput) as never);

    expect(
      prisma.ticket.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
        }),
      }),
    );
  });

  it("allows resubmission when only rejected tickets exist", async () => {
    vi.mocked(
      prisma.ticket.findMany,
    ).mockResolvedValue([]);

    const response = await POST(
      request(validInput) as never,
    );

    expect(response.status).toBe(201);
    expect(
      uploadFileToCloudinary,
    ).toHaveBeenCalledOnce();
  });

  it("creates a ticket successfully with a UTC-safe departure date", async () => {
    const response = await POST(
      request(validInput) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(
      prisma.ticket.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        destination: "New Delhi",
        departureDate: new Date(
          "2026-08-15T00:00:00.000Z",
        ),
        ticketUrl:
          "https://example.com/ticket.pdf",
        status: TicketStatus.PENDING,
      }),
    });
  });

  it("deletes the uploaded Cloudinary asset when database creation fails", async () => {
    vi.mocked(
      prisma.ticket.create,
    ).mockRejectedValue(
      new Error("Database unavailable"),
    );

    const response = await POST(
      request(validInput) as never,
    );

    expect(response.status).toBe(500);
    expect(
      deleteCloudinaryAsset,
    ).toHaveBeenCalledWith(
      "travellers/tickets/ticket-1",
    );
  });

  it("does not hide the original failure when Cloudinary cleanup also fails", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    vi.mocked(
      prisma.ticket.create,
    ).mockRejectedValue(
      new Error("Database unavailable"),
    );
    vi.mocked(
      deleteCloudinaryAsset,
    ).mockRejectedValue(
      new Error("Cloudinary unavailable"),
    );

    const response = await POST(
      request(validInput) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Failed to upload ticket",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Cloudinary cleanup failed after ticket creation error:",
      "Cloudinary unavailable",
    );

    consoleSpy.mockRestore();
  });

  it("replays a completed idempotent request", async () => {
    vi.mocked(
      claimIdempotencyKey,
    ).mockResolvedValue({
      state: "replay",
      result: {
        status: 201,
        body: {
          ok: true,
          ticket: { id: "ticket-previous" },
        },
      },
    });

    const response = await POST(
      request(
        validInput,
        "ticket-upload:request-123",
      ) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(
      response.headers.get(
        "Idempotency-Replayed",
      ),
    ).toBe("true");
    expect(body.ticket.id).toBe(
      "ticket-previous",
    );
    expect(
      prisma.ticket.create,
    ).not.toHaveBeenCalled();
  });

  it("stores the successful result for future idempotency replays", async () => {
    const claim = {
      state: "acquired" as const,
      storageKey: "result-key",
      lockKey: "lock-key",
    };

    vi.mocked(
      claimIdempotencyKey,
    ).mockResolvedValue(claim);

    await POST(
      request(
        validInput,
        "ticket-upload:request-456",
      ) as never,
    );

    expect(
      storeIdempotencyResult,
    ).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        status: 201,
        body: expect.objectContaining({
          ok: true,
        }),
      }),
    );
  });

  it("releases the idempotency lock after a failed request", async () => {
    const claim = {
      state: "acquired" as const,
      storageKey: "result-key",
      lockKey: "lock-key",
    };

    vi.mocked(
      claimIdempotencyKey,
    ).mockResolvedValue(claim);
    vi.mocked(
      prisma.ticket.create,
    ).mockRejectedValue(
      new Error("Database unavailable"),
    );

    await POST(
      request(
        validInput,
        "ticket-upload:request-789",
      ) as never,
    );

    expect(
      releaseIdempotencyClaim,
    ).toHaveBeenCalledWith(claim);
  });
});
