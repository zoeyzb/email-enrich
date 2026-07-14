import { load } from "cheerio";
import { fetchHtml } from "./utils";

export interface TeamSignals {
  sources_checked: string[];
  founder_mentioned: boolean;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasNameMention(text: string, first: string, last: string): boolean {
  if (!first || !last) return false;
  const exact = new RegExp(`\\b${escapeRegex(first)}\\s+${escapeRegex(last)}\\b`);
  const shortWindow = new RegExp(`\\b${escapeRegex(first)}\\b(?:\\s+[a-z]{1,20}){0,2}\\s+\\b${escapeRegex(last)}\\b`);
  return exact.test(text) || shortWindow.test(text);
}

export async function collectTeamSignals(domain: string, personName: string): Promise<TeamSignals> {
  const paths = ["/team", "/people", "/about", "/about-us", "/our-team", "/leadership"];
  const origins = [`https://${domain}`, `https://www.${domain}`];
  const sources: string[] = [];
  const normalizedName = normalize(personName);
  const tokens = normalizedName.split(" ").filter(Boolean);
  const first = tokens[0] ?? "";
  const last = tokens[tokens.length - 1] ?? "";
  let founderMentioned = false;

  for (const origin of origins) {
    for (const path of paths) {
      const url = `${origin}${path}`;
      const html = await fetchHtml(url);
      if (!html) continue;
      sources.push(url);
      const $ = load(html);
      const pageText = normalize($.root().text());
      if (hasNameMention(pageText, first, last)) {
        founderMentioned = true;
      }
      if (founderMentioned) {
        return {
          sources_checked: sources,
          founder_mentioned: true,
        };
      }
    }
  }

  return {
    sources_checked: sources,
    founder_mentioned: founderMentioned,
  };
}
