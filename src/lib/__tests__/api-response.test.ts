import { NextRequest } from "next/server";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  API_ERROR_CODES,
  formatZodError,
  logApiError,
} from "@/lib/api-error";
import {
  apiError,
  apiJson,
} from "@/lib/api-response";
import {
  createRequestId,
  getRequestId,
  isValidRequestId,
} from "@/lib/request-id";
import { withValidation } from "@/lib/withValidation";

describe("request IDs", () => {
  it("reuses a valid client-provided request ID", () => {
    const request = new NextRequest(
      "http://localhost/api/test",
      {
        headers: {
          "X-Request-ID": "req_ClientProvided123",
        },
      },
    );

    expect(getRequestId(request)).toBe(
      "req_ClientProvided123",
    );
  });

  it("rejects malformed request IDs", () => {
    const request = new NextRequest(
      "http://localhost/api/test",
      {
        headers: {
          "X-Request-ID": "bad id\ninjected",
        },
      },
    );

    const result = getRequestId(request);

    expect(result).not.toContain("bad id");
    expect(isValidRequestId(result)).toBe(true);
  });

  it("creates valid unique request IDs", () => {
    const first = createRequestId();
    const second = createRequestId();

    expect(isValidRequestId(first)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("API responses", () => {
  it("adds X-Request-ID to success responses", async () => {
    const response = apiJson(
      { ok: true },
      "req_Success123",
      { status: 201 },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-ID")).toBe(
      "req_Success123",
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    [API_ERROR_CODES.UNAUTHORIZED, 401],
    [API_ERROR_CODES.FORBIDDEN, 403],
    [API_ERROR_CODES.NOT_FOUND, 404],
    [API_ERROR_CODES.VALIDATION_ERROR, 400],
    [API_ERROR_CODES.CONFLICT, 409],
    [API_ERROR_CODES.INTERNAL_ERROR, 500],
  ])(
    "creates a stable %s error response",
    async (code, status) => {
      const response = apiError(
        "req_Error123",
        code,
        "Safe public message",
        status,
      );

      expect(response.status).toBe(status);
      expect(response.headers.get("X-Request-ID")).toBe(
        "req_Error123",
      );
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message: "Safe public message",
          requestId: "req_Error123",
          details: null,
        },
      });
    },
  );
});

describe("Zod formatting", () => {
  it("returns safe field-level details", () => {
    const schema = z.object({
      destination: z.string().min(1, "Destination required"),
      age: z.number().min(18, "Must be at least 18"),
    });
    const result = schema.safeParse({
      destination: "",
      age: 10,
    });

    if (result.success) {
      throw new Error("Expected validation to fail");
    }

    expect(formatZodError(result.error)).toEqual({
      destination: ["Destination required"],
      age: ["Must be at least 18"],
    });
  });

  it("standardizes withValidation failures", async () => {
    const handler = vi.fn();
    const route = withValidation(
      z.object({
        destination: z.string().min(
          1,
          "Destination is required",
        ),
      }),
      handler,
      undefined,
      { standardizeErrors: true },
    );

    const request = new NextRequest(
      "http://localhost/api/test",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Request-ID": "req_Validation123",
        },
        body: JSON.stringify({ destination: "" }),
      },
    );

    const response = await route(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "The request data is invalid",
        requestId: "req_Validation123",
        details: {
          destination: ["Destination is required"],
        },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("safe logging", () => {
  it("includes the request ID without logging a stack", () => {
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logApiError(
      "req_Log123",
      "Example operation",
      new Error("Database unavailable"),
    );

    expect(spy).toHaveBeenCalledWith(
      "[req_Log123] Example operation",
      {
        name: "Error",
        message: "Database unavailable",
      },
    );

    spy.mockRestore();
  });
});
