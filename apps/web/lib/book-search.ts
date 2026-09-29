import { normalizeTitleForContainment, type ResourceCandidate, type ResourceType } from "@media-track/workflow";
import { getAccountScopedSettings, getCurrentAccountId, PANSOU_BASE_URL_SETTING_KEY } from "./workflow-runtime";
import { buildPanSouProviderChain, resolveUserPanSouBaseUrl } from "./pansou-chain";

export interface BookLink {
  title: string;
  type: ResourceType;
  source: string;
  url: string;
  password: string;
}

export interface BookSearchResult {
  links: BookLink[];
  status: "healthy" | "degraded" | "unreachable" | "protocol_error";
}

function bookLink(candidate: ResourceCandidate): BookLink | null {
  const url = candidate.providerPayload.url;
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "magnet:") return null;
  } catch {
    return null;
  }
  return {
    title: candidate.title || "未命名资源",
    type: candidate.type,
    source: candidate.source,
    url,
    password: typeof candidate.providerPayload.password === "string" ? candidate.providerPayload.password : "",
  };
}

/** PanSou is a general media index and may return unrelated short dramas for a
 *  book query. Only expose results naming the work AND an ebook format/label. */
export function isBookResourceTitle(candidateTitle: string, bookTitle: string): boolean {
  const name = normalizeTitleForContainment(bookTitle);
  const candidate = normalizeTitleForContainment(candidateTitle);
  if (name.length < 2 || !candidate.includes(name)) return false;
  return /(?:epub|mobi|azw3?|pdf|djvu|fb2|电子书|电子版|图书|书籍|小说|kindle)/i.test(candidateTitle);
}

export async function searchBookLinks(query: string): Promise<BookSearchResult> {
  const keyword = query.trim().slice(0, 120);
  if (!keyword) return { links: [], status: "healthy" };
  const settings = getAccountScopedSettings(await getCurrentAccountId());
  const provider = buildPanSouProviderChain({
    userBaseURL: resolveUserPanSouBaseUrl(await settings.getSetting(PANSOU_BASE_URL_SETTING_KEY)),
    // Offline magnets are currently confirmed by VIDEO landing in the storage
    // executors; an ebook can be cancelled as a miss. Book transfer uses shares.
    allowedTypes: ["115", "quark", "tianyi", "123", "guangya"],
  });
  try {
    const snapshot = await provider.search({ keyword });
    return {
      links: snapshot.candidates
        .filter((candidate) => isBookResourceTitle(candidate.title, keyword))
        .map(bookLink)
        .filter((link): link is BookLink => link !== null)
        .slice(0, 80),
      status: snapshot.sourceHealth?.status ?? "healthy",
    };
  } catch {
    return { links: [], status: "unreachable" };
  }
}
