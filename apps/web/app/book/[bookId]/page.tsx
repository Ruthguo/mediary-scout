import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { AppSidebar } from "../../../components/app-sidebar";
import { BookTransferButton } from "../../../components/book-transfer-button";
import { getBookMetadata, searchBooks } from "../../../lib/book-metadata";
import { refreshPendingBookEntry } from "../../../lib/workflow-runtime";

export default function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<div className="app-shell" />}><BookContent params={params} searchParams={searchParams} /></Suspense>;
}

async function BookContent({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bookId }, values] = await Promise.all([params, searchParams]);
  if (!/^douban_\d+$/.test(bookId) && !/^query_.{1,360}$/.test(bookId)) notFound();
  const storageId = typeof values.w === "string" ? values.w : undefined;
  const saved = await refreshPendingBookEntry(bookId, storageId);
  const query = typeof values.q === "string" ? values.q.slice(0, 120) : "";
  let book = saved?.book ?? null;
  if (!book && query) {
    try { book = (await searchBooks(query)).find((item) => item.id === bookId) ?? null; } catch { /* detail fallback below */ }
  }
  if (!book) {
    try { book = await getBookMetadata(bookId, query); } catch { /* show unavailable state */ }
  }
  if (!book) notFound();

  const basePath = storageId ? `/w/${storageId}` : "/";
  return (
    <div className="app-shell">
      <AppSidebar active="none" basePath={basePath} activeStorageId={storageId} />
      <main className="main product-main product-main-hub">
        <Link className="panel-note" href={`${basePath}?tab=search&kind=book&q=${encodeURIComponent(query || book.title)}`}>‹ 返回搜书</Link>
        <section className="book-detail-hero">
          <div className="book-detail-cover">
            {book.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={book.coverUrl} alt={`${book.title}封面`} />
            ) : <BookOpen size={48} aria-hidden />}
          </div>
          <div>
            <p className="panel-note">书籍{saved ? ` · ${saved.status === "saved" ? "已入库" : "转存处理中"}` : ""}</p>
            <h1>{book.title}</h1>
            <p>{book.authors.join("、") || "作者未知"}{book.year ? ` · ${book.year}` : ""}</p>
            {book.description ? <p className="book-description">{book.description}</p> : null}
            {saved ? <p className="panel-note">{saved.directoryPath} · {saved.fileCount} 个文件</p> : null}
            <BookTransferButton query={book.title} bookId={book.id} storageId={storageId} />
            {book.sourceUrl ? <a className="panel-note" href={book.sourceUrl} target="_blank" rel="noopener noreferrer">查看书籍资料</a> : null}
          </div>
        </section>
      </main>
    </div>
  );
}
