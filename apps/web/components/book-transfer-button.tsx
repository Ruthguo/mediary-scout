"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { requestBookAction } from "../app/actions";

export function BookTransferButton({
  query,
  bookId,
  storageId,
}: {
  query: string;
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
            setResult(await requestBookAction({ query, bookId, storageId }));
          } catch (error) {
            setResult({ status: "failed", message: error instanceof Error ? error.message : "转存失败，请稍后重试。" });
          }
        })}
      >
        {pending ? <LoaderCircle size={16} className="spin" aria-hidden /> : <Plus size={16} aria-hidden />}
        {pending ? "获取中" : result?.status === "saved" ? "已获取" : result?.status === "pending" ? "已提交" : "获取"}
      </button>
      {result ? <span role={result.status === "failed" ? "alert" : "status"}>{result.message}</span> : null}
    </div>
  );
}
