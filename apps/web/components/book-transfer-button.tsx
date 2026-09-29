"use client";

import { useState, useTransition } from "react";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { requestBookAction } from "../app/actions";
import { untrackBookAction } from "../app/actions";
import { useRouter } from "../lib/use-router";

export function BookTransferButton({
  query,
  bookId,
  storageId,
  initialStatus,
}: {
  query: string;
  bookId: string;
  storageId?: string | undefined;
  initialStatus?: "pending" | "saved" | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; message: string } | null>(
    initialStatus === "saved"
      ? { status: "saved", message: "这本书已入库。" }
      : initialStatus === "pending"
        ? { status: "pending", message: "转存处理中。" }
        : null,
  );
  if (result?.status === "saved") {
    return <div className="request-track book-actions"><span className="hub-badge tone-green"><Check size={12} aria-hidden />已获取</span><button className="secondary-button" type="button" disabled={pending} onClick={() => startTransition(async () => { try { const response = await untrackBookAction({ bookId, storageId }); if (response.status === "untracked") { router.push(`${storageId ? `/w/${encodeURIComponent(storageId)}` : "/"}?tab=library&type=book`); } else { setResult({ status: "failed", message: response.message }); } } catch (error) { setResult({ status: "failed", message: error instanceof Error ? error.message : "取消追踪失败，请刷新后重试。" }); } })}>取消追踪</button>{result.status === "failed" ? <span role="alert">{result.message}</span> : null}</div>;
  }
  return (
    <div className="request-track book-actions">
      <button
        className="primary-button"
        type="button"
        disabled={pending || result?.status === "pending"}
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
