import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../app/actions", () => ({ requestBookAction: vi.fn(), untrackBookAction: vi.fn() }));
vi.mock("../lib/use-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { BookTransferButton } from "./book-transfer-button";

describe("book library retry", () => {
  it("offers acquisition again for a failed library entry", () => {
    const html = renderToStaticMarkup(createElement(BookTransferButton, {
      bookId: "douban_123", query: "翠鸟谋杀案", storageId: "drive1", initialStatus: "failed",
    }));
    expect(html).toContain("重新获取");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("转存处理中");
  });

  it("prevents duplicate acquisition while the entry is queued", () => {
    const html = renderToStaticMarkup(createElement(BookTransferButton, {
      bookId: "douban_123", query: "翠鸟谋杀案", initialStatus: "queued",
    }));
    expect(html).toContain("disabled");
    expect(html).toContain("已提交");
  });
});
