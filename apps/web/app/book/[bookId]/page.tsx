import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookOpen, TriangleAlert } from "lucide-react";
import { allowedResourceTypesForKinds, getStorageBrand, isRegisteredStorageProvider } from "@media-track/workflow";
import { AppSidebar } from "../../../components/app-sidebar";
import { BookTransferButton } from "../../../components/book-transfer-button";
import { getBookMetadata, searchBooks } from "../../../lib/book-metadata";
import { searchBookLinks } from "../../../lib/book-search";
import { getActiveWorkspaceScope, getWorkflowRepository, refreshPendingBookEntry } from "../../../lib/workflow-runtime";

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
  if (!/^OL\d+W$/.test(bookId)) notFound();
  const storageId = typeof values.w === "string" ? values.w : undefined;
  const scope = await getActiveWorkspaceScope(storageId);
  const repository = getWorkflowRepository();
  const saved = await refreshPendingBookEntry(bookId, storageId);
  const query = typeof values.q === "string" ? values.q.slice(0, 120) : "";
  let book = saved?.book ?? null;
  if (!book && query) {
    try { book = (await searchBooks(query)).find((item) => item.id === bookId) ?? null; } catch { /* detail fallback below */ }
  }
  if (!book) {
    try { book = await getBookMetadata(bookId); } catch { /* show unavailable state */ }
  }
  if (!book) notFound();

  const basePath = storageId ? `/w/${storageId}` : "/";
  const storages = await repository.listConnectedStorages(scope.accountId);
  const currentDrive = storages.find((drive) => drive.id === scope.connectedStorageId);
  const supported = currentDrive && isRegisteredStorageProvider(currentDrive.provider)
    ? new Set(allowedResourceTypesForKinds(getStorageBrand(currentDrive.provider).resourceProviderKinds))
    : null;
  const resourceResult = await searchBookLinks(book.title);
  const links = supported ? resourceResult.links.filter((link) => supported.has(link.type)) : resourceResult.links;
  const sourceFailed = resourceResult.status === "unreachable" || resourceResult.status === "protocol_error";

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
            <a className="panel-note" href={book.sourceUrl} target="_blank" rel="noopener noreferrer">查看书籍资料</a>
          </div>
        </section>
        <section className="search-results" aria-label="书籍资源">
          <div className="section-heading"><div><h2>可用资源</h2><p>{links.length} 条当前网盘可用链接</p></div></div>
          {sourceFailed ? (
            <div className="quiet-state compact" role="alert"><TriangleAlert size={22} aria-hidden /><strong>资源搜索暂时不可用</strong><span>请检查 PanSou 搜索源后重试。</span></div>
          ) : links.length === 0 ? (
            <div className="quiet-state compact"><BookOpen size={22} aria-hidden /><strong>暂无可用资源</strong><span>可以换个关键词再搜。</span></div>
          ) : (
            <div className="book-link-grid">
              {links.map((link) => (
                <article className="book-link-card" key={link.url}>
                  <h3>{link.title}</h3>
                  <p>{link.type.toUpperCase()}{link.source ? ` · ${link.source}` : ""}</p>
                  {link.password ? <p>提取码：{link.password}</p> : null}
                  <div className="book-link-actions">
                    <BookTransferButton query={book.title} bookId={book.id} url={link.url} storageId={storageId} />
                    <a className="secondary-button" href={link.url} target="_blank" rel="noopener noreferrer">打开资源</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
