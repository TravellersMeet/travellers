import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {},
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

vi.mock("@/lib/match-cache", () => ({
  invalidateMatchCachesForTicket: vi.fn(),
}));

import * as ticketRoute from "../route";

describe("admin ticket route exports", () => {
  it("exports PATCH and GET handlers", () => {
    expect(typeof ticketRoute.PATCH).toBe("function");
    expect(typeof ticketRoute.GET).toBe("function");
  });
});
