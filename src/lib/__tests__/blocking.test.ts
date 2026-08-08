import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  blockPairWhere,
  findBlockBetween,
  getBlockedUserIds,
  isBlockedBetween,
} from "@/lib/blocking";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    block: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe("blockPairWhere", () => {
  it("matches a block in both directions", () => {
    expect(blockPairWhere("user-1", "user-2")).toEqual({
      OR: [
        { blockerId: "user-1", blockedId: { in: ["user-2"] } },
        { blockerId: { in: ["user-2"] }, blockedId: "user-1" },
      ],
    });
  });

  it("accepts a list of counterparts", () => {
    expect(
      blockPairWhere("user-1", ["user-2", "user-3"]),
    ).toEqual({
      OR: [
        {
          blockerId: "user-1",
          blockedId: { in: ["user-2", "user-3"] },
        },
        {
          blockerId: { in: ["user-2", "user-3"] },
          blockedId: "user-1",
        },
      ],
    });
  });

  it("de-duplicates and drops blank ids", () => {
    expect(
      blockPairWhere("user-1", [
        "user-2",
        "user-2",
        "",
        "   ",
      ]),
    ).toEqual({
      OR: [
        { blockerId: "user-1", blockedId: { in: ["user-2"] } },
        { blockerId: { in: ["user-2"] }, blockedId: "user-1" },
      ],
    });
  });
});

describe("findBlockBetween", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without querying when there are no counterparts", async () => {
    await expect(
      findBlockBetween("user-1", []),
    ).resolves.toBeNull();

    expect(prisma.block.findFirst).not.toHaveBeenCalled();
  });

  it("queries both directions in a single lookup", async () => {
    vi.mocked(prisma.block.findFirst).mockResolvedValue(
      null as never,
    );

    await findBlockBetween("user-1", ["user-2"]);

    expect(prisma.block.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.block.findFirst).toHaveBeenCalledWith({
      where: blockPairWhere("user-1", ["user-2"]),
      select: { id: true },
    });
  });
});

describe("isBlockedBetween", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is true when the caller blocked the counterpart", async () => {
    vi.mocked(prisma.block.findFirst).mockResolvedValue({
      id: "block-1",
    } as never);

    await expect(
      isBlockedBetween("user-1", "user-2"),
    ).resolves.toBe(true);
  });

  it("is true when the counterpart blocked the caller", async () => {
    // The direction is decided by the query, so a hit means blocked either way.
    vi.mocked(prisma.block.findFirst).mockResolvedValue({
      id: "block-2",
    } as never);

    await expect(
      isBlockedBetween("user-2", "user-1"),
    ).resolves.toBe(true);
  });

  it("is false when the pair is clear", async () => {
    vi.mocked(prisma.block.findFirst).mockResolvedValue(
      null as never,
    );

    await expect(
      isBlockedBetween("user-1", "user-2"),
    ).resolves.toBe(false);
  });
});

describe("getBlockedUserIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects counterparts from both block directions", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      { blockerId: "user-1", blockedId: "user-2" },
      { blockerId: "user-3", blockedId: "user-1" },
    ] as never);

    await expect(
      getBlockedUserIds("user-1"),
    ).resolves.toEqual(["user-2", "user-3"]);
  });

  it("de-duplicates a mutual block", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue([
      { blockerId: "user-1", blockedId: "user-2" },
      { blockerId: "user-2", blockedId: "user-1" },
    ] as never);

    await expect(
      getBlockedUserIds("user-1"),
    ).resolves.toEqual(["user-2"]);
  });

  it("returns an empty list when nothing is blocked", async () => {
    vi.mocked(prisma.block.findMany).mockResolvedValue(
      [] as never,
    );

    await expect(
      getBlockedUserIds("user-1"),
    ).resolves.toEqual([]);
  });
});
