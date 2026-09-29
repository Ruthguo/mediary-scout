import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return new Response("missing url", { status: 400 });
  let url: URL;
  try { url = new URL(raw); } catch { return new Response("invalid url", { status: 400 }); }
  if (url.hostname !== "img.doubanio.com" && !/^img\d+\.doubanio\.com$/.test(url.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }
  const response = await fetch(url, {
    headers: { Referer: "https://book.douban.com/", "User-Agent": "Mozilla/5.0 MediaryScout/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body) return new Response("cover unavailable", { status: 502 });
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
