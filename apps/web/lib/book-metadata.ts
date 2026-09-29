import type { BookTitle } from "@media-track/workflow";

const SEARCH_BASE = "https://openlibrary.org/search.json";
const WORK_BASE = "https://openlibrary.org/works";
const ID_PATTERN = /^OL\d+W$/;
const searchCache = new Map<string, { expiresAt: number; books: BookTitle[] }>();

interface OpenLibraryDoc {
  key?: unknown;
  title?: unknown;
  author_name?: unknown;
  first_publish_year?: unknown;
  cover_i?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bookFromDoc(doc: OpenLibraryDoc): BookTitle | null {
  const id = text(doc.key).replace(/^\/works\//, "");
  const title = text(doc.title);
  if (!ID_PATTERN.test(id) || !title) return null;
  return {
    id,
    title,
    authors: Array.isArray(doc.author_name) ? doc.author_name.map(text).filter(Boolean).slice(0, 4) : [],
    year: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
    coverUrl: typeof doc.cover_i === "number" ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    description: "",
    sourceUrl: `${WORK_BASE}/${id}`,
  };
}

export async function searchBooks(query: string): Promise<BookTitle[]> {
  const keyword = query.trim().slice(0, 120);
  if (!keyword) return [];
  const cacheKey = keyword.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.books;
  const url = new URL(SEARCH_BASE);
  url.searchParams.set(Array.from(keyword).length < 3 ? "title" : "q", keyword);
  url.searchParams.set("limit", "20");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,cover_i");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Open Library search HTTP ${response.status}`);
  const body = await response.json() as { docs?: OpenLibraryDoc[] };
  const books = (Array.isArray(body.docs) ? body.docs : []).map(bookFromDoc).filter((book): book is BookTitle => book !== null);
  searchCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, books });
  return books;
}

export async function getBookMetadata(id: string): Promise<BookTitle | null> {
  if (!ID_PATTERN.test(id)) return null;
  const response = await fetch(`${WORK_BASE}/${id}.json`, { signal: AbortSignal.timeout(10_000), next: { revalidate: 21600 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Library work HTTP ${response.status}`);
  const work = await response.json() as Record<string, unknown>;
  const title = text(work.title);
  if (!title) return null;
  const cover = Array.isArray(work.covers) && typeof work.covers[0] === "number" ? work.covers[0] : null;
  const rawDescription = work.description;
  return {
    id,
    title,
    authors: [],
    year: null,
    coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-M.jpg` : null,
    description: text(typeof rawDescription === "object" && rawDescription !== null ? (rawDescription as { value?: unknown }).value : rawDescription),
    sourceUrl: `${WORK_BASE}/${id}`,
  };
}
