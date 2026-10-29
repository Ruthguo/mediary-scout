import { describe, expect, it } from "vitest";
import { bookResourceRank, isBookResourceTitle } from "./book-search";

describe("book resource title filtering", () => {
  it("keeps title matches for the agent and ranks ebook evidence ahead of video results", () => {
    expect(isBookResourceTitle("《三体》刘慈欣 EPUB+PDF", "三体")).toBe(true);
    expect(isBookResourceTitle("三体 电视剧 2023 4K", "三体")).toBe(true);
    expect(bookResourceRank("《三体》刘慈欣 EPUB+PDF", "三体")).toBeGreaterThan(bookResourceRank("三体 电视剧 2023 4K", "三体"));
    expect(isBookResourceTitle("早逝白月光 电子书", "三体")).toBe(false);
    expect(isBookResourceTitle("三体（刘慈欣）.azw3", "三体")).toBe(true);
  });
});
