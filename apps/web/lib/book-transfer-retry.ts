export interface BookTransferCandidate {
  title: string;
}

export interface BookTransferResult {
  status: "saved" | "pending" | "unsupported" | "failed";
  message: string;
}

export const MAX_BOOK_TRANSFER_ATTEMPTS = 10;

/** Only retry failures that identify a dead or access-restricted share. Account,
 * quota, VIP, network, and protocol failures must stop immediately: changing the
 * candidate cannot fix them and would only burn requests. */
export function isRetryableBookShareFailure(message: string): boolean {
  return /QUARK_SHARE_TOKEN_FAILED:\s*code=(?:41006|41031)\b|QUARK_TRANSFER_FAILED:\s*share has no transferable files\b|分享者用户封禁|分享(?:链接)?(?:不存在|已取消|已失效|失效|过期)|链接(?:已)?(?:失效|过期)|(?:访问|提取)码错误/i.test(message);
}

/** Parse only indices the agent explicitly approved. A dead primary share may
 * fall through this whitelist, never into the unreviewed search remainder. */
export function parseBookResourceSelection(
  answer: string,
  candidateCount: number,
  maxAttempts = MAX_BOOK_TRANSFER_ATTEMPTS,
): number[] {
  const trimmed = answer.trim();
  if (!trimmed || /^NONE$/i.test(trimmed) || candidateCount <= 0 || maxAttempts <= 0) return [];
  let values: unknown;
  try {
    values = JSON.parse(trimmed);
  } catch {
    values = /^\d+$/.test(trimmed) ? [Number(trimmed)] : [];
  }
  if (!Array.isArray(values)) return [];
  const selected: number[] = [];
  for (const value of values) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) continue;
    const index = value - 1;
    if (index < 0 || index >= candidateCount || selected.includes(index)) continue;
    selected.push(index);
    if (selected.length >= maxAttempts) break;
  }
  return selected;
}

export async function transferBookCandidates<
  TCandidate extends BookTransferCandidate,
  TResult extends BookTransferResult,
>(input: {
  candidates: readonly TCandidate[];
  selectedIndices: readonly number[];
  transfer: (candidate: TCandidate, index: number) => Promise<TResult>;
  maxAttempts?: number;
}): Promise<TResult> {
  const order = [...new Set(input.selectedIndices)]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < input.candidates.length)
    .slice(0, input.maxAttempts ?? MAX_BOOK_TRANSFER_ATTEMPTS);
  if (order.length === 0) throw new Error("BOOK_TRANSFER_CANDIDATE_INVALID");

  let last: TResult | null = null;
  for (const index of order) {
    const result = await input.transfer(input.candidates[index]!, index);
    last = result;
    if (result.status !== "failed" || !isRetryableBookShareFailure(result.message)) return result;
  }
  return last!;
}
