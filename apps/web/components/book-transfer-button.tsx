"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, Plus } from "lucide-react";
import { requestBookAction } from "../app/actions";
import { UntrackButton } from "./untrack-button";

export function BookTransferButton({
  query,
  bookId,
  storageId,
  initialStatus,
  messageContainerId,
}: {
  query: string;
  bookId: string;
  storageId?: string | undefined;
  initialStatus?: "queued" | "running" | "pending" | "saved" | "failed" | undefined;
  messageContainerId?: string | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [messageContainer, setMessageContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (messageContainerId) setMessageContainer(document.getElementById(messageContainerId));
  }, [messageContainerId]);
  const [result, setResult] = useState<{ status: string; message: string } | null>(
    initialStatus === "saved"
      ? { status: "saved", message: "这本书已入库。" }
      : initialStatus === "queued" || initialStatus === "running" || initialStatus === "pending"
        ? { status: "pending", message: "转存处理中。" }
        : null,
  );
  const untrack = initialStatus || result?.status === "saved" || result?.status === "pending" ? (
    <UntrackButton mediaKind="book" bookId={bookId} storageId={storageId} basePath={storageId ? `/w/${encodeURIComponent(storageId)}` : "/"} disabled={pending || result?.status === "pending"} />
  ) : null;
  if (result?.status === "saved") {
    return <div className="request-track book-actions"><span className="hub-badge tone-green"><Check size={12} aria-hidden />已获取</span>{untrack}</div>;
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
        {pending ? "获取中" : result?.status === "saved" ? "已获取" : result?.status === "pending" ? "已提交" : initialStatus === "failed" || result?.status === "failed" ? "重新获取" : "获取"}
      </button>
      {untrack}
      {result ? (() => {
        const message = <span className={`book-action-message${result.status === "failed" ? " is-error" : ""}`} role={result.status === "failed" ? "alert" : "status"}>{result.message}</span>;
        return messageContainerId ? messageContainer ? createPortal(message, messageContainer) : null : message;
      })() : null}
    </div>
  );
}
