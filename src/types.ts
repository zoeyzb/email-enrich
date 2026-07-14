import { z } from "zod";

export const emailEnrichInputSchema = z.object({
  person_name: z.string().min(1).describe("Full name of the person (e.g. 'John Smith')"),
  company_name: z.string().min(1).describe("Company name (e.g. 'Acme Corp')"),
  company_domain: z.string().optional().default("").describe("Company domain (e.g. 'acme.com'). Preferred over company_website."),
  company_website: z.string().optional().default("").describe("Full company website URL. Domain will be extracted if company_domain not provided."),
  hints: z.object({
    role: z.string().optional().default("").describe("Person's role (e.g. 'CEO', 'CTO')"),
    source_urls: z.array(z.string()).optional().default([]).describe("URLs where this person was found"),
  }).optional().default({}),
  mode: z.enum(["default", "strict", "fast"]).optional().default("default").describe(
    "default: full pipeline with verification. strict: no guessing, only verified emails (0.6+ confidence). fast: skip SMTP verification."
  ),
  real_only: z.boolean().optional().default(false).describe(
    "If true, return only emails actually found on public pages for the company domain. No guessed addresses."
  ),
  use_case: z.enum(["general", "ai_research", "vc", "sales", "cold_outreach"]).optional().default("general").describe(
    "Use-case hint for signal collection/ranking. cold_outreach: prioritizes real harvested emails, reduces false positives (0.4+ confidence threshold, max 5 candidates)."
  ),
});

export type EmailEnrichInput = z.infer<typeof emailEnrichInputSchema>;
export type EnrichMode = EmailEnrichInput["mode"];

export interface EmailCandidate {
  email: string;
  confidence: number;
  reason: string;
}

export interface HarvestResult {
  emails: string[];
  sources_checked: string[];
  pages_fetched: number;
}

export interface PatternResult {
  pattern: "first.last" | "first" | "firstlast" | "f.last" | "flast" | "firstl" | "last.first" | "last" | "unknown";
  confidence: number;
  sample_count: number;
}

export interface VerificationResult {
  method: "smtp_probe" | "none" | "fallback_api";
  result: "valid" | "invalid" | "unknown" | "catch_all";
}

export interface VerificationAttempt {
  email: string;
  method: VerificationResult["method"];
  result: VerificationResult["result"];
}

export interface EmailEnrichResult {
  status: "ok" | "not_found" | "needs_user_input" | "rate_limited" | "error";
  best_email?: string;
  confidence?: number;
  candidates: EmailCandidate[];
  evidence: {
    domain: string;
    sources_checked: string[];
    found_public_emails: string[];
    pattern_inferred: PatternResult["pattern"];
    verification: VerificationResult;
    verification_attempts?: VerificationAttempt[];
    people_pages?: string[];
    publication_pages?: string[];
    github_urls?: string[];
    arxiv_urls?: string[];
    signal_emails?: string[];
  };
  next_best_action?: string;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface ParsedName {
  first: string;
  last: string;
  firstInitial: string;
  tokens: string[];
  confidence: number;
}

export interface DomainResolutionResult {
  domain: string;
  confidence: number;
  method: "provided_domain" | "website_extract" | "dns_guess";
}
