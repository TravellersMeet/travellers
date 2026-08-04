import type { NextRequest } from "next/server";

import { apiJson } from "@/lib/api-response";
import {
  getReadinessStatus,
  runReadinessChecks,
} from "@/lib/health-checks";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const checks = await runReadinessChecks();
  const status = getReadinessStatus(checks);

  return apiJson(
    {
      status,
      timestamp: new Date().toISOString(),
      requestId,
      checks,
    },
    requestId,
    {
      status: status === "unavailable" ? 503 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
