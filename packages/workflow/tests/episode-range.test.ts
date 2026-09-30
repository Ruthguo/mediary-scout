import { describe, expect, it } from "vitest";
import { episodeUpperBoundHint } from "../src/episode-range.js";

describe("episodeUpperBoundHint", () => {
  it.each([
    ["剧集 更至6集 4K", 6],
    ["剧集 更新到06集", 6],
    ["剧集 1-6集", 6],
    ["剧集 1~06集", 6],
    ["剧集 全12集", 12],
    ["Show.S01E06.2160p", 6],
    ["Show E06 2160p", 6],
  ])("extracts a conservative season-1 hint from %s", (title, expected) => {
    expect(episodeUpperBoundHint(title, 1)).toBe(expected);
  });

  it("requires an explicit season marker for season 2+", () => {
    expect(episodeUpperBoundHint("Show 更新至6集", 2)).toBeNull();
    expect(episodeUpperBoundHint("Show S02E06", 2)).toBe(6);
    expect(episodeUpperBoundHint("Show 第2季 更新至6集", 2)).toBe(6);
    expect(episodeUpperBoundHint("Show Season 2 更新至6集", 2)).toBe(6);
    expect(episodeUpperBoundHint("Show S02 更新至6集", 2)).toBe(6);
  });

  it.each(["Show 2026 2160p", "Show 第6季", "Show E2160p", "Show 1-6GB"])(
    "rejects unrelated numbers in %s",
    (title) => expect(episodeUpperBoundHint(title, 1)).toBeNull(),
  );

  it("rejects an explicitly different season", () => {
    expect(episodeUpperBoundHint("Show S02E06 更新至6集", 1)).toBeNull();
  });

  it("does not assign an ambiguous range from a multi-season title", () => {
    expect(episodeUpperBoundHint("Show 第1季 更新至6集 第2季 更新至10集", 1)).toBeNull();
    expect(episodeUpperBoundHint("Show 第1季 更新至6集 第2季 更新至10集", 2)).toBeNull();
  });

  it("still accepts explicit episode codes in a multi-season title", () => {
    expect(episodeUpperBoundHint("Show S01E10 S02E06", 1)).toBe(10);
    expect(episodeUpperBoundHint("Show S01E10 S02E06", 2)).toBe(6);
  });
});
