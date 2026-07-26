import { handlers } from "@/lib/auth";
import {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitIdentifier,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

export const GET = handlers.GET;

function isCredentialsCallback(request: NextRequest): boolean {
  return request.nextUrl.pathname.endsWith(
    "/api/auth/callback/credentials",
  );
}

async function getCredentialsEmail(
  request: NextRequest,
): Promise<string | null> {
  try {
    const form = await request.clone().formData();
    const email = form.get("email");

    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isCredentialsCallback(request)) {
    return handlers.POST(request);
  }

  const email = await getCredentialsEmail(request);
  const rateLimit = await checkRateLimit({
    namespace: "auth:signin",
    identifier: getRateLimitIdentifier(request, email),
    limit: 10,
    windowSeconds: 10 * 60,
  });

  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  const response = await handlers.POST(request);
  return applyRateLimitHeaders(response, rateLimit);
}
