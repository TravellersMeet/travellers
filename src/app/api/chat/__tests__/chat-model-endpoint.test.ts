import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetSeconds: 60,
    bypassed: false,
  }),
}));

import { POST } from "../route";

describe("POST /api/chat - Gemini model endpoint", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-api-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createRequest = (body: any) => {
    return {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    } as any;
  };

  it("calls the supported Gemini 2.0 Flash endpoint by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Hello! How can I help you with your tickets?" }],
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock;

    const req = createRequest({ message: "Hello" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reply).toBe("Hello! How can I help you with your tickets?");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "test-api-key",
        }),
      }),
    );
  });

  it("respects GEMINI_MODEL environment variable override when configured", async () => {
    process.env.GEMINI_MODEL = "gemini-1.5-flash";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Response from 1.5 flash" }],
            },
          },
        ],
      }),
    });
    global.fetch = fetchMock;

    const req = createRequest({ message: "Hi" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reply).toBe("Response from 1.5 flash");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      expect.anything(),
    );
  });
});
