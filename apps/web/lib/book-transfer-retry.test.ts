import { describe, expect, it, vi } from "vitest";
import {
  isRetryableBookShareFailure,
  parseBookResourceSelection,
  transferBookCandidates,
} from "./book-transfer-retry";

describe("book share retry", () => {
  it("tries another candidate after a banned Quark share", async () => {
    const candidates = [
      { title: "猫鱼 (陈冲) (Z-Library).azw3", url: "dead" },
      { title: "猫鱼 (陈冲) (Z-Library).azw3", url: "live" },
    ];
    const transfer = vi.fn(async (candidate: (typeof candidates)[number]) => candidate.url === "dead"
      ? { status: "failed" as const, message: "QUARK_SHARE_TOKEN_FAILED: code=41031 分享者用户封禁链接查看受限" }
      : { status: "saved" as const, message: "saved" });

    await expect(transferBookCandidates({ candidates, selectedIndices: [0, 1], transfer })).resolves.toEqual({
      status: "saved",
      message: "saved",
    });
    expect(transfer.mock.calls.map(([candidate]) => candidate.url)).toEqual(["dead", "live"]);
  });

  it("does not roll through candidates for an account-level failure", async () => {
    const candidates = [{ title: "猫鱼.azw3" }, { title: "猫鱼.epub" }];
    const transfer = vi.fn(async () => ({ status: "failed" as const, message: "QUARK_AUTH_EXPIRED: 请重新登录" }));

    await transferBookCandidates({ candidates, selectedIndices: [0, 1], transfer });
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it("uses only the ordered candidate whitelist returned by the agent", () => {
    expect(parseBookResourceSelection("[32,33,35,32,99]", 40)).toEqual([31, 32, 34]);
    expect(parseBookResourceSelection("NONE", 40)).toEqual([]);
    expect(parseBookResourceSelection("not json", 40)).toEqual([]);
  });

  it("classifies known dead shares but not systemic failures", () => {
    expect(isRetryableBookShareFailure("QUARK_SHARE_TOKEN_FAILED: code=41006 分享不存在")).toBe(true);
    expect(isRetryableBookShareFailure("QUARK_TRANSFER_FAILED: share has no transferable files")).toBe(true);
    expect(isRetryableBookShareFailure("分享链接已失效")).toBe(true);
    expect(isRetryableBookShareFailure("容量不足，请清理空间")).toBe(false);
    expect(isRetryableBookShareFailure("QUARK_TRANSFER_FAILED: save task rejected")).toBe(false);
  });
});
