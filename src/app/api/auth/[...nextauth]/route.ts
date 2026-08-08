import { handlers } from "@/lib/auth";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
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
  const rateLimit = await enforceRateLimit(request, "authSignin", email);

  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  const response = await handlers.POST(request);
  return applyRateLimitHeaders(response, rateLimit);
}
