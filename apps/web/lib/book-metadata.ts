import type { BookTitle } from "@media-track/workflow";
import { load } from "cheerio";

const SEARCH_URL = "https://book.douban.com/j/subject_suggest";
const cache = new Map<string, { expiresAt: number; books: BookTitle[] }>();

interface DoubanBook { id?: unknown; title?: unknown; url?: unknown; pic?: unknown; author_name?: unknown; year?: unknown }
function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function mapBook(row: DoubanBook): BookTitle | null {
  const id = stringValue(row.id);
  const title = stringValue(row.title);
  if (!/^\d+$/.test(id) || !title) return null;
  return {
    id: `douban_${id}`,
    title,
    authors: stringValue(row.author_name).split(/[、,/]/).map((author) => author.trim()).filter(Boolean).slice(0, 5),
    year: /^\d{4}$/.test(stringValue(row.year)) ? Number(row.year) : null,
    coverUrl: stringValue(row.pic) || null,
    description: "",
    sourceUrl: stringValue(row.url) || `https://book.douban.com/subject/${id}/`,
  };
}

export async function searchBooks(query: string): Promise<BookTitle[]> {
  const keyword = query.trim().slice(0, 120);
  if (!keyword) return [];
  const key = keyword.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.books;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", keyword);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json", "User-Agent": "MediaryScout/1.0" } });
  if (!response.ok) throw new Error(`Douban book search HTTP ${response.status}`);
  const body = await response.json() as unknown;
  const books = Array.isArray(body)
    ? body.map((row) => (row && typeof row === "object" ? mapBook(row as DoubanBook) : null)).filter((book): book is BookTitle => book !== null)
    : [];
  const result = books.length > 0 ? await Promise.all(books.map(async (book) => {
    try {
      const html = await fetch(book.sourceUrl, { signal: AbortSignal.timeout(8_000), headers: { Accept: "text/html", "User-Agent": "MediaryScout/1.0" } }).then((response) => response.ok ? response.text() : "");
      const document = load(html);
      const description = document("#link-report .intro").first().text(" ").replace(/\s+/g, " ").trim();
      return description ? { ...book, description: description.slice(0, 900) } : book;
    } catch {
      return book;
    }
  })) : [{
    id: `query_${encodeURIComponent(keyword)}`,
    title: keyword,
    authors: [],
    year: null,
    coverUrl: null,
    description: "",
    sourceUrl: "",
  }];
  cache.set(key, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, books: result });
  return result;
}

export async function getBookMetadata(id: string, query?: string): Promise<BookTitle | null> {
  if (id.startsWith("query_") && query?.trim()) {
    const title = decodeURIComponent(id.slice("query_".length));
    return { id, title, authors: [], year: null, coverUrl: null, description: "", sourceUrl: "" };
  }
  if (!/^douban_\d+$/.test(id) || !query?.trim()) return null;
  return (await searchBooks(query)).find((book) => book.id === id) ?? null;
}
