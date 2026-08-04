import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { DELETE } from "@/app/api/user/account/route";
import { deleteUserAccount } from "@/lib/account-deletion";
import { auth } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/account-deletion", () => ({
  deleteUserAccount: vi.fn(),
}));

function createRequest(
  confirmation: unknown = "DELETE",
) {
  return new NextRequest(
    "http://localhost/api/user/account",
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "X-Request-ID": "req_accountdelete123",
      },
      body: JSON.stringify({
        confirmation,
      }),
    },
  );
}

describe("DELETE /api/user/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await DELETE(createRequest());

    expect(response.status).toBe(401);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("requires exact deletion confirmation", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as never);

    const response = await DELETE(
      createRequest("delete"),
    );

    expect(response.status).toBe(400);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("clears auth data and reports pending asset cleanup", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as never);
    vi.mocked(deleteUserAccount).mockResolvedValue({
      alreadyDeleted: false,
      queuedAssets: 2,
      cleanup: {
        processed: 2,
        deleted: 1,
        pending: 1,
      },
    });

    const response = await DELETE(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      response.headers.get("Clear-Site-Data"),
    ).toBe('"cookies", "storage"');
    expect(body).toMatchObject({
      deleted: true,
      cleanupPending: true,
      assets: {
        queued: 2,
        deleted: 1,
        pending: 1,
      },
    });
  });

  it("returns a safe error when the transaction fails", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as never);
    vi.mocked(deleteUserAccount).mockRejectedValue(
      new Error(
        "postgresql://secret:password@host/db",
      ),
    );

    const response = await DELETE(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(
      "password",
    );
  });
});
