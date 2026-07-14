import { promises as dns } from "dns";
import type { DomainResolutionResult, EmailEnrichInput } from "./types";
import { ENRICH_CONFIG } from "./constants";

const COMPANY_SUFFIXES = [
  "inc",
  "corp",
  "corporation",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "co",
  "company",
];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function isValidDomain(domain: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain);
}

function normalizeCompanyName(companyName: string): string {
  let normalized = companyName.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const suffix of COMPANY_SUFFIXES) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\b`, "g"), " ");
  }
  return normalized.replace(/\s+/g, "").trim();
}

async function hasDnsRecord(host: string): Promise<boolean> {
  try {
    await withTimeout(dns.resolve4(host), 3000);
    return true;
  } catch {
    try {
      await withTimeout(dns.resolve6(host), 3000);
      return true;
    } catch {
      return false;
    }
  }
}

export async function resolveCompanyDomain(input: Pick<EmailEnrichInput, "company_name" | "company_domain" | "company_website">): Promise<DomainResolutionResult | null> {
  try {
    if (input.company_domain) {
      const domain = normalizeDomain(input.company_domain);
      if (isValidDomain(domain)) {
        return { domain, confidence: 1, method: "provided_domain" };
      }
    }

    if (input.company_website) {
      try {
        const host = new URL(input.company_website).hostname;
        const domain = normalizeDomain(host);
        if (isValidDomain(domain)) {
          return { domain, confidence: 0.95, method: "website_extract" };
        }
      } catch {
        // Continue with optional DNS guess flow.
      }
    }

    if (!ENRICH_CONFIG.enableDnsGuess) {
      return null;
    }

    const base = normalizeCompanyName(input.company_name);
    if (!base) return null;

    const tlds = [".com", ".io", ".co", ".ai", ".dev"];
    let attempts = 0;
    for (const tld of tlds) {
      if (attempts >= 5) break;
      attempts += 1;
      const guess = `${base}${tld}`;
      if (await hasDnsRecord(guess)) {
        return { domain: guess, confidence: tld === ".com" ? 0.7 : 0.6, method: "dns_guess" };
      }
    }

    return null;
  } catch {
    return null;
  }
}
