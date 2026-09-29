"use client";

import { useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { transferBookAction } from "../app/actions";

export function BookTransferButton({
  query,
  url,
  bookId,
  storageId,
}: {
  query: string;
  url: string;
  bookId: string;
  storageId?: string | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  return (
    <div className="book-transfer-action">
      <button
        className="primary-button"
        type="button"
        disabled={pending || result?.status === "saved" || result?.status === "pending"}
        onClick={() => startTransition(async () => {
          try {
            setResult(await transferBookAction({ query, url, bookId, storageId }));
          } catch (error) {
            setResult({ status: "failed", message: error instanceof Error ? error.message : "转存失败，请稍后重试。" });
          }
        })}
      >
        {pending ? <LoaderCircle size={16} className="spin" aria-hidden /> : null}
        {pending ? "转存中" : result?.status === "saved" ? "已转存" : result?.status === "pending" ? "已提交" : "转存到网盘"}
      </button>
      {result ? <span role={result.status === "failed" ? "alert" : "status"}>{result.message}</span> : null}
    </div>
  );
}
