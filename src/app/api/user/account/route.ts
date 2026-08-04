import type { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import {
  apiError,
  apiJson,
} from "@/lib/api-response";
import { deleteUserAccount } from "@/lib/account-deletion";
import { auth } from "@/lib/auth";
import { getRequestId } from "@/lib/request-id";

const DELETE_CONFIRMATION = "DELETE";

function clearAuthenticationCookies(
  response: Response,
): Response {
  response.headers.set(
    "Clear-Site-Data",
    '"cookies", "storage"',
  );
  response.headers.set(
    "Cache-Control",
    "no-store",
  );
  return response;
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.id) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return apiError(
      requestId,
      API_ERROR_CODES.BAD_REQUEST,
      "Invalid request format",
      400,
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("confirmation" in body) ||
    body.confirmation !== DELETE_CONFIRMATION
  ) {
    return apiError(
      requestId,
      API_ERROR_CODES.VALIDATION_ERROR,
      'Type "DELETE" to confirm account deletion',
      400,
    );
  }

  try {
    const result = await deleteUserAccount(
      session.user.id,
    );

    const response = apiJson(
      {
        deleted: true,
        alreadyDeleted: result.alreadyDeleted,
        assets: {
          queued: result.queuedAssets,
          deleted: result.cleanup.deleted,
          pending: result.cleanup.pending,
        },
        cleanupPending:
          result.cleanup.pending > 0,
      },
      requestId,
      {
        status: 200,
      },
    );

    return clearAuthenticationCookies(response);
  } catch (error) {
    logApiError(
      requestId,
      "Account deletion failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to delete the account",
      500,
    );
  }
}
