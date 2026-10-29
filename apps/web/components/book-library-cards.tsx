import Link from "next/link";
import { CheckCircle2, Clock3, TriangleAlert } from "lucide-react";
import type { BookLibraryEntry } from "@media-track/workflow";

export function BookCategoryRow({ books, storageId }: { books: BookLibraryEntry[]; storageId?: string | undefined }) {
  if (books.length === 0) return null;
  const basePath = storageId ? `/w/${storageId}` : "/";
  return (
    <div className="category-section">
      <Link className="category-header" href={`${basePath}?tab=library&type=book`}><h2>书籍 {books.length}</h2><span className="category-arrow">›</span></Link>
      <div className="poster-row">{books.map((entry) => <BookPosterCard entry={entry} storageId={storageId} key={`${entry.connectedStorageId}:${entry.book.id}`} />)}</div>
    </div>
  );
}

export function BookPosterCard({ entry }: { entry: BookLibraryEntry; storageId?: string | undefined }) {
  const href = `/book/${entry.book.id}?w=${encodeURIComponent(entry.connectedStorageId)}`;
  const label = entry.status === "saved" ? "已入库" : entry.status === "failed" ? "获取失败" : "获取中";
  const StatusIcon = entry.status === "saved" ? CheckCircle2 : entry.status === "failed" ? TriangleAlert : Clock3;
  return (
    <Link className="wall-card" href={href}>
      <span className="wall-poster">
        {entry.book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.book.coverUrl} alt="" loading="lazy" />
        ) : <span className="poster-fallback">{entry.book.title.slice(0, 4)}</span>}
        <span className="wall-states"><span className={`wall-state tone-${entry.status === "saved" ? "green" : "amber"}`} title={label}><StatusIcon size={13} aria-hidden /></span></span>
      </span>
      <span className="wall-copy"><strong>{entry.book.title}</strong><span>{entry.book.authors.join("、") || "作者未知"} · {label}</span></span>
    </Link>
  );
}
