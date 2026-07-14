import { load } from "cheerio";
import {
  COMPANY_PAGE_PATHS_BASE,
  COMPANY_PAGE_PATHS_FULL,
  ENRICH_CONFIG,
  EXTRA_LINK_HINTS,
  IMAGE_EXTENSIONS,
  PLACEHOLDER_DOMAINS,
} from "./constants";
import type { EnrichMode, HarvestResult } from "./types";
import { deobfuscate, extractEmailsFromText, runWithConcurrency, sameDomain } from "./utils";

function isJunkEmail(email: string): boolean {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return true;
  if (localPart.length > 64 || email.length > 254) return true;
  if (localPart.startsWith("noreply") || localPart.startsWith("no-reply") || localPart.startsWith("mailer-daemon")) return true;
  if (PLACEHOLDER_DOMAINS.has(domain)) return true;
  if (IMAGE_EXTENSIONS.some((ext) => email.includes(ext))) return true;
  return false;
}

function normalizeEmailForDomain(email: string, domain: string): string {
  const lower = email.toLowerCase();
  const suffix = `@www.${domain}`;
  if (lower.endsWith(suffix)) {
    return `${lower.slice(0, -suffix.length)}@${domain}`;
  }
  return lower;
}

function extractEmailsFromHtml(html: string): string[] {
  const text = deobfuscate(html);
  const $ = load(text);
  const collected = new Set<string>();

  for (const email of extractEmailsFromText(text)) {
    if (!isJunkEmail(email)) collected.add(email);
  }

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (email && !isJunkEmail(email)) collected.add(email);
  });

  // Cloudflare email protection
  $("[data-cfemail]").each((_, el) => {
    const encoded = ($(el).attr("data-cfemail") ?? "").trim();
    const decoded = decodeCloudflareEmail(encoded);
    if (decoded && !isJunkEmail(decoded)) {
      collected.add(decoded.toLowerCase());
    }
  });

  return Array.from(collected);
}

function decodeCloudflareEmail(encoded: string): string {
  if (!encoded || encoded.length < 4 || encoded.length % 2 !== 0) return "";
  try {
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    if (!Number.isFinite(key)) return "";
    let out = "";
    for (let i = 2; i < encoded.length; i += 2) {
      const value = Number.parseInt(encoded.slice(i, i + 2), 16);
      if (!Number.isFinite(value)) return "";
      out += String.fromCharCode(value ^ key);
    }
    return out;
  } catch {
    return "";
  }
}

function getPathSetForMode(mode: EnrichMode): readonly string[] {
  if (mode === "fast") return COMPANY_PAGE_PATHS_BASE;
  return COMPANY_PAGE_PATHS_FULL;
}

function getBaseUrlsFromOrigins(origins: string[], mode: EnrichMode): string[] {
  const paths = getPathSetForMode(mode);
  const urls: string[] = [];
  for (const origin of origins) {
    for (const path of paths) {
      urls.push(`${origin}${path}`);
    }
  }
  return Array.from(new Set(urls));
}

function isLikelyHtmlLink(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  const blocked = [
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
    ".pdf", ".zip", ".rar", ".7z",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp4", ".mp3", ".avi", ".mov",
  ];
  return !blocked.some((suffix) => path.endsWith(suffix));
}

async function fetchText(url: string): Promise<{ url: string; content: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENRICH_CONFIG.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PulseBot/1.0)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return { url, content: "", contentType: "" };
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = contentType.includes("text/html");
    const isPlain = contentType.includes("text/plain") || url.endsWith(".txt") || url.endsWith(".xml");
    if (!isHtml && !isPlain) return { url, content: "", contentType };
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 512 * 1024) return { url, content: "", contentType };
    const text = await res.text();
    if (text.length > 512 * 1024) return { url, content: "", contentType };
    return { url: res.url || url, content: text, contentType };
  } catch {
    return { url, content: "", contentType: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseSitemapUrls(xml: string, domain: string): string[] {
  const urls = new Set<string>();
  const locRegex = /<loc>(.*?)<\/loc>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (!sameDomain(u.hostname, domain)) continue;
      const p = u.pathname.toLowerCase();
      if (!EXTRA_LINK_HINTS.some((hint) => p.includes(hint))) continue;
      urls.add(`${u.protocol}//${u.hostname}${u.pathname}`);
    } catch {
      // Ignore invalid URL in sitemap.
    }
  }
  return Array.from(urls).slice(0, 12);
}

function parseSitemapEntries(xml: string): string[] {
  const urls = new Set<string>();
  const locRegex = /<loc>(.*?)<\/loc>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = match[1]?.trim();
    if (raw) urls.add(raw);
  }
  return Array.from(urls);
}

function discoverInternalLinksFromPage(pageUrl: string, pageHtml: string, domain: string): string[] {
  const $ = load(pageHtml);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    const lowerHref = href.toLowerCase();
    const looksRelevant =
      EXTRA_LINK_HINTS.some((hint) => lowerHref.includes(hint)) ||
      lowerHref.includes("contact") ||
      lowerHref.includes("email") ||
      lowerHref.includes("investor") ||
      lowerHref.includes("team") ||
      lowerHref.includes("press") ||
      lowerHref.includes("media") ||
      lowerHref.includes("impressum") ||
      lowerHref.includes("legal") ||
      lowerHref.includes("privacy") ||
      lowerHref.includes("portfolio") ||
      lowerHref.includes("people") ||
      lowerHref.includes("partners");
    if (!looksRelevant) return;
    try {
      const resolved = new URL(href, pageUrl);
      if (!sameDomain(resolved.hostname, domain)) return;
      if (!isLikelyHtmlLink(resolved)) return;
      links.add(`${resolved.protocol}//${resolved.hostname}${resolved.pathname}`);
    } catch {
      // Ignore invalid links.
    }
  });
  return Array.from(links).slice(0, 20);
}

function getAuxiliaryTextUrls(domain: string, mode: EnrichMode): string[] {
  if (mode === "fast") return [];
  return [
    `https://${domain}/robots.txt`,
    `https://${domain}/humans.txt`,
    `https://${domain}/.well-known/security.txt`,
    `https://www.${domain}/robots.txt`,
    `https://www.${domain}/humans.txt`,
    `https://www.${domain}/.well-known/security.txt`,
  ];
}

async function fetchSitemapHints(domain: string, mode: EnrichMode): Promise<string[]> {
  if (mode === "fast") return [];
  const seedSitemaps = [
    `https://${domain}/sitemap.xml`,
    `https://www.${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://www.${domain}/sitemap_index.xml`,
  ];
  const fetched = await runWithConcurrency(seedSitemaps, 2, async (url) => fetchText(url));
  const childSitemaps = new Set<string>();
  const hints = new Set<string>();

  for (const item of fetched) {
    if (!item.content) continue;
    for (const loc of parseSitemapEntries(item.content)) {
      try {
        const u = new URL(loc);
        if (!sameDomain(u.hostname, domain)) continue;
        const isNestedSitemap =
          u.pathname.toLowerCase().includes("sitemap") &&
          (u.pathname.toLowerCase().endsWith(".xml") || u.pathname.toLowerCase().endsWith(".xml.gz"));
        if (isNestedSitemap) childSitemaps.add(loc);
      } catch {
        // Ignore malformed urls.
      }
    }
    for (const found of parseSitemapUrls(item.content, domain)) {
      hints.add(found);
    }
  }

  const childFetched = await runWithConcurrency(Array.from(childSitemaps).slice(0, 10), 2, async (url) => fetchText(url));
  for (const item of childFetched) {
    if (!item.content) continue;
    for (const found of parseSitemapUrls(item.content, domain)) {
      hints.add(found);
    }
  }

  return Array.from(hints).slice(0, 12);
}

function selectFirstWaveTargets(domain: string, mode: EnrichMode, sitemapHints: string[], textUrls: string[]): string[] {
  const maxPages = Math.max(8, ENRICH_CONFIG.maxPagesPerDomain);
  const primaryOrigins = mode === "fast"
    ? [`https://${domain}`]
    : [`https://${domain}`, `https://www.${domain}`];
  const secondaryOrigins = mode === "fast" ? [] : [`http://${domain}`, `http://www.${domain}`];

  const primaryBase = getBaseUrlsFromOrigins(primaryOrigins, mode);
  const secondaryBase = getBaseUrlsFromOrigins(secondaryOrigins, mode);

  const selected = mergeTargets(
    primaryBase,
    sitemapHints,
    textUrls,
    secondaryBase
  );
  return selected.slice(0, maxPages);
}

function remainingCapacity(currentSize: number): number {
  const maxPages = Math.max(8, ENRICH_CONFIG.maxPagesPerDomain);
  return Math.max(0, maxPages - currentSize);
}

function mergeTargets(...groups: string[][]): string[] {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const url of group) {
      if (!url) continue;
      merged.add(url);
    }
  }
  return Array.from(merged);
}

export async function harvestPublicEmails(input: { domain: string; mode: EnrichMode }): Promise<HarvestResult> {
  try {
    const sitemapHints = await fetchSitemapHints(input.domain, input.mode);
    const textUrls = getAuxiliaryTextUrls(input.domain, input.mode);
    const firstWaveTargets = selectFirstWaveTargets(input.domain, input.mode, sitemapHints, textUrls);
    const contentByUrl = new Map<string, { content: string; contentType: string }>();

    await runWithConcurrency(firstWaveTargets, 4, async (url) => {
      const fetched = await fetchText(url);
      contentByUrl.set(url, { content: fetched.content, contentType: fetched.contentType });
      return true;
    });

    const discovered = new Set<string>();
    for (const [url, entry] of contentByUrl.entries()) {
      if (!entry.content || !entry.contentType.includes("text/html")) continue;
      for (const link of discoverInternalLinksFromPage(url, entry.content, input.domain)) {
        discovered.add(link);
      }
    }

    const secondWaveTargets = Array.from(discovered)
      .filter((url) => !contentByUrl.has(url))
      .slice(0, remainingCapacity(contentByUrl.size));
    await runWithConcurrency(secondWaveTargets, 4, async (url) => {
      const fetched = await fetchText(url);
      contentByUrl.set(url, { content: fetched.content, contentType: fetched.contentType });
      return true;
    });

    if (input.mode !== "fast" && remainingCapacity(contentByUrl.size) > 0) {
      const discoveredLevel3 = new Set<string>();
      for (const [url, entry] of contentByUrl.entries()) {
        if (!entry.content || !entry.contentType.includes("text/html")) continue;
        for (const link of discoverInternalLinksFromPage(url, entry.content, input.domain)) {
          if (!contentByUrl.has(link)) discoveredLevel3.add(link);
        }
      }
      const thirdWaveTargets = Array.from(discoveredLevel3).slice(0, remainingCapacity(contentByUrl.size));
      await runWithConcurrency(thirdWaveTargets, 4, async (url) => {
        const fetched = await fetchText(url);
        contentByUrl.set(url, { content: fetched.content, contentType: fetched.contentType });
        return true;
      });
    }

    const emails = new Set<string>();
    const sourcesChecked: string[] = [];
    let pagesFetched = 0;

    for (const [url, entry] of contentByUrl.entries()) {
      if (!entry.content) continue;
      pagesFetched += 1;
      sourcesChecked.push(url);
      for (const email of extractEmailsFromHtml(entry.content)) {
        emails.add(normalizeEmailForDomain(email, input.domain));
      }
    }

    return {
      emails: Array.from(emails),
      sources_checked: sourcesChecked,
      pages_fetched: pagesFetched,
    };
  } catch {
    return { emails: [], sources_checked: [], pages_fetched: 0 };
  }
}

export const __private__ = {
  deobfuscate,
  extractEmailsFromHtml,
};
