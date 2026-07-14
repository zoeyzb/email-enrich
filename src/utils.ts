import { EMAIL_REGEX, ENRICH_CONFIG } from "./constants";

const DEFAULT_UA = "Mozilla/5.0 (compatible; PulseBot/1.0)";
const MAX_FETCH_BYTES = 512 * 1024;

export function deobfuscate(input: string): string {
  return input
    .replace(/\[at\]|\(at\)|\sat\s/gi, "@")
    .replace(/\[dot\]|\(dot\)|\sdot\s/gi, ".")
    .replace(/&#64;/g, "@")
    .replace(/&#46;/g, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".");
}

export function sameDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h === `www.${d}` || h.endsWith(`.${d}`);
}

export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENRICH_CONFIG.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": DEFAULT_UA },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html")) return "";
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_FETCH_BYTES) return "";
    const text = await res.text();
    return text.length > MAX_FETCH_BYTES ? "" : text;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export function extractEmailsFromText(input: string): string[] {
  const text = deobfuscate(input);
  return Array.from(new Set((text.match(EMAIL_REGEX) ?? []).map((e) => e.toLowerCase())));
}

export async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.allSettled(workers);
  return results;
}
