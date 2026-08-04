import type { NextRequest } from "next/server";

import { apiJson } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  return apiJson(
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      requestId,
    },
    requestId,
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
