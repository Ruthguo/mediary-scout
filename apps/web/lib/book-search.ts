import { normalizeTitleForContainment, type ResourceCandidate, type ResourceType } from "@media-track/workflow";
import { getAccountScopedSettings, getCurrentAccountId, PANSOU_BASE_URL_SETTING_KEY } from "./workflow-runtime";
import { buildPanSouProviderChain, resolveUserPanSouBaseUrl } from "./pansou-chain";

export interface BookLink {
  title: string;
  evidence: string;
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
    evidence: typeof candidate.providerPayload.content === "string" ? candidate.providerPayload.content : "",
    type: candidate.type,
    source: candidate.source,
    url,
    password: typeof candidate.providerPayload.password === "string" ? candidate.providerPayload.password : "",
  };
}

/** PanSou is a general media index. Keep title matches here; the acquisition
 * agent decides whether a candidate is a real book resource. */
export function isBookResourceTitle(candidateTitle: string, bookTitle: string): boolean {
  const name = normalizeTitleForContainment(bookTitle);
  const candidate = normalizeTitleForContainment(candidateTitle);
  if (name.length < 2 || !candidate.includes(name)) return false;
  return true;
}

/** PanSou is ordered for broad media search, so a book's exact title can be
 * buried behind unrelated titles that merely contain one character. Rank the
 * candidates before the caller's safety limit is applied. */
export function bookResourceRank(candidateTitle: string, bookTitle: string): number {
  const title = normalizeTitleForContainment(candidateTitle);
  const name = normalizeTitleForContainment(bookTitle);
  let score = title === name ? 1000 : title.includes(name) ? 300 : 0;
  if (/小说文学|电子书|ebook|全格式|文字版|精校|kindle/i.test(candidateTitle)) score += 180;
  if (/\b(epub|azw3?|mobi|txt|pdf)\b|\.(epub|azw3?|mobi|txt|pdf)(?:$|[\s._-])/i.test(candidateTitle)) score += 120;
  if (/短剧|电视剧|电影|动漫|有声|听书|朗读|音频|音乐|游戏|课程/i.test(candidateTitle)) score -= 800;
  return score;
}

export async function searchBookLinks(query: string, accountId?: string): Promise<BookSearchResult> {
  const keyword = query.trim().slice(0, 120);
  if (!keyword) return { links: [], status: "healthy" };
  const settings = getAccountScopedSettings(accountId ?? await getCurrentAccountId());
  const provider = buildPanSouProviderChain({
    userBaseURL: resolveUserPanSouBaseUrl(await settings.getSetting(PANSOU_BASE_URL_SETTING_KEY)),
    // Offline magnets are currently confirmed by VIDEO landing in the storage
    // executors; an ebook can be cancelled as a miss. Book transfer uses shares.
    allowedTypes: ["115", "quark", "uc", "tianyi", "123", "guangya"],
  });
  try {
    const snapshot = await provider.search({ keyword });
    return {
      links: snapshot.candidates
        .filter((candidate) => isBookResourceTitle(candidate.title, keyword))
        .map(bookLink)
        .filter((link): link is BookLink => link !== null)
        .sort((a, b) => bookResourceRank(b.title, keyword) - bookResourceRank(a.title, keyword))
        .slice(0, 80),
      status: snapshot.sourceHealth?.status ?? "healthy",
    };
  } catch {
    return { links: [], status: "unreachable" };
  }
}
