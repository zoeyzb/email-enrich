import { load } from "cheerio";
import { extractEmailsFromText, fetchHtml, runWithConcurrency, sameDomain } from "./utils";

export interface ResearchSignals {
  people_pages: string[];
  publication_pages: string[];
  github_urls: string[];
  arxiv_urls: string[];
  signal_emails: string[];
  sources_checked: string[];
}

function extractEmails(html: string): string[] {
  return extractEmailsFromText(html);
}

export async function collectResearchSignals(domain: string): Promise<ResearchSignals> {
  try {
    const candidatePaths = [
      "/people",
      "/team",
      "/research",
      "/publications",
      "/papers",
      "/about",
      "/lab",
    ];
    const baseUrls = [
      `https://${domain}`,
      `https://www.${domain}`,
    ];
    const targets: string[] = [];
    for (const base of baseUrls) {
      for (const path of candidatePaths) {
        targets.push(`${base}${path}`);
      }
    }

    const peoplePages = new Set<string>();
    const publicationPages = new Set<string>();
    const githubUrls = new Set<string>();
    const arxivUrls = new Set<string>();
    const signalEmails = new Set<string>();
    const sourcesChecked: string[] = [];

    const cappedTargets = targets.slice(0, 20);
    const pages = await runWithConcurrency(cappedTargets, 4, async (url) => ({
      url,
      html: await fetchHtml(url),
    }));

    for (const page of pages) {
      const url = page.url;
      const html = page.html;
      if (!html) continue;
      sourcesChecked.push(url);
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes("/people") || lowerUrl.includes("/team") || lowerUrl.includes("/lab")) {
        peoplePages.add(url);
      }
      if (lowerUrl.includes("/publication") || lowerUrl.includes("/papers") || lowerUrl.includes("/research")) {
        publicationPages.add(url);
      }

      for (const email of extractEmails(html)) {
        const emailDomain = email.split("@")[1] ?? "";
        if (sameDomain(emailDomain, domain)) signalEmails.add(email);
      }

      const $ = load(html);
      $("a[href]").each((_, el) => {
        const href = ($(el).attr("href") ?? "").trim();
        if (!href) return;
        try {
          const resolved = new URL(href, url).toString();
          if (resolved.includes("github.com/")) githubUrls.add(resolved);
          if (resolved.includes("arxiv.org/")) arxivUrls.add(resolved);
          const lower = resolved.toLowerCase();
          if (lower.includes("/people") || lower.includes("/team") || lower.includes("/lab")) {
            peoplePages.add(resolved);
          }
          if (lower.includes("/publication") || lower.includes("/papers") || lower.includes("/research")) {
            publicationPages.add(resolved);
          }
        } catch {
          // ignore bad url
        }
      });
    }

    return {
      people_pages: Array.from(peoplePages).slice(0, 20),
      publication_pages: Array.from(publicationPages).slice(0, 20),
      github_urls: Array.from(githubUrls).slice(0, 20),
      arxiv_urls: Array.from(arxivUrls).slice(0, 20),
      signal_emails: Array.from(signalEmails).slice(0, 50),
      sources_checked: sourcesChecked,
    };
  } catch {
    return {
      people_pages: [],
      publication_pages: [],
      github_urls: [],
      arxiv_urls: [],
      signal_emails: [],
      sources_checked: [],
    };
  }
}
