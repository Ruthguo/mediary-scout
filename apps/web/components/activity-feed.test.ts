import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookActivityRow, cancelCopy } from "./activity-feed";

describe("book activity result", () => {
  const book = { runId: "book_123", bookId: "123", title: "翠鸟谋杀案", authors: "作者", coverUrl: null, activity: "Agent 未找到可信的电子书资源。" };

  it("ends the progress indicator on failure and keeps the reason and scoped retry link", () => {
    const html = renderToStaticMarkup(createElement(BookActivityRow, { book: { ...book, status: "failed" }, storageId: "drive 1" }));
    expect(html).toContain(book.activity);
    expect(html).toContain("act-row-done");
    expect(html).not.toContain("act-bar");
    expect(html).not.toContain("act-spin");
    expect(html).toContain('/book/123?w=drive%201');
    expect(html).toContain("查看书籍并重试");
  });

  it("keeps the progress indicator while acquisition is pending", () => {
    const html = renderToStaticMarkup(createElement(BookActivityRow, { book: { ...book, status: "pending", activity: "正在查找电子书资源…" } }));
    expect(html).toContain("act-row-active");
    expect(html).toContain("act-bar");
    expect(html).toContain("act-spin");
    expect(html).not.toContain("查看书籍并重试");
  });
});

describe("cancelCopy — what cancelling a queued run says it does", () => {
  it("an acquisition goes with its title: 取消并移出", () => {
    expect(cancelCopy("type2_init")).toEqual({ action: "取消获取", confirm: "取消并移出", note: null });
    expect(cancelCopy("movie_init")).toEqual({ action: "取消获取", confirm: "取消并移出", note: null });
  });

  it("a replace run only drops this attempt: the library stays and the swap waits for the next patrol", () => {
    // A patrol-queued replace run may carry only 待换 episodes and no message at all,
    // so the note speaks of the swap, not of a message.
    expect(cancelCopy("replace_request")).toEqual({
      action: "取消这次换源",
      confirm: "取消这次换源",
      note: "等下次巡检再换",
    });
  });
});
