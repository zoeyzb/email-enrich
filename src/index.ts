import { ENRICH_CONFIG, GENERIC_LOCAL_PARTS } from "./constants";
import { domainEmailsCache, domainPatternCache } from "./cache";
import { resolveCompanyDomain } from "./domain";
import { harvestPublicEmails, harvestPublicSourceUrls } from "./harvest";
import { inferEmailPattern } from "./patterns";
import { parsePersonName } from "./name_parser";
import { generateEmailCandidates } from "./candidates";
import { verifyEmailViaSmtp } from "./verify_smtp";
import { emailEnrichRateLimiter } from "./rate_limit";
import { emailEnrichInputSchema, type EmailEnrichInput, type EmailEnrichResult, type ParsedName, type VerificationAttempt, type VerificationResult } from "./types";
import { collectResearchSignals, type ResearchSignals } from "./research_signals";
import { collectTeamSignals } from "./team_signals";

function unknownEvidence(): EmailEnrichResult["evidence"] {
  return {
    domain: "",
    sources_checked: [],
    found_public_emails: [],
    pattern_inferred: "unknown",
    verification: { method: "none", result: "unknown" },
    verification_attempts: [],
    people_pages: [],
    publication_pages: [],
    github_urls: [],
    arxiv_urls: [],
    signal_emails: [],
  };
}

function deriveClientIp(userId: string, rawInput: unknown): string {
  if (rawInput && typeof rawInput === "object") {
    const record = rawInput as Record<string, unknown>;
    const candidate =
      record.ip ??
      record.client_ip ??
      record.clientIp ??
      record["x-forwarded-for"] ??
      record.x_forwarded_for;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.split(",")[0]!.trim();
    }
  }
  return `user:${userId}`;
}

function buildEvidence(params: {
  domain: string;
  harvestSources: string[];
  researchSources: string[];
  teamSources: string[];
  mergedEmails: string[];
  pattern: EmailEnrichResult["evidence"]["pattern_inferred"];
  verification?: VerificationResult;
  verificationAttempts?: VerificationAttempt[];
  peoplePages: string[];
  publicationPages: string[];
  githubUrls: string[];
  arxivUrls: string[];
  signalEmails: string[];
}): EmailEnrichResult["evidence"] {
  return {
    domain: params.domain,
    sources_checked: Array.from(new Set([...params.harvestSources, ...params.researchSources, ...params.teamSources])),
    found_public_emails: params.mergedEmails,
    pattern_inferred: params.pattern,
    verification: params.verification ?? { method: "none", result: "unknown" },
    verification_attempts: params.verificationAttempts ?? [],
    people_pages: params.peoplePages,
    publication_pages: params.publicationPages,
    github_urls: params.githubUrls,
    arxiv_urls: params.arxivUrls,
    signal_emails: params.signalEmails,
  };
}

function getDomainVariants(domain: string): string[] {
  const d = domain.toLowerCase();
  const parts = d.split(".").filter(Boolean);
  const twoLevel = parts.length >= 2 ? parts.slice(-2).join(".") : d;
  const threeLevelCountryTld = parts.length >= 3 && /^(co|com|org|net|gov|edu)$/.test(parts[parts.length - 2]);
  const threeLevel = threeLevelCountryTld ? parts.slice(-3).join(".") : twoLevel;
  return Array.from(new Set([d, twoLevel, threeLevel]));
}

function isCompanyDomainEmail(email: string, domain: string): boolean {
  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!emailDomain) return false;
  const variants = getDomainVariants(domain);
  return variants.some((v) => emailDomain === v || emailDomain.endsWith(`.${v}`));
}

function toRealEmailCandidates(emails: string[], domain: string) {
  const ownDomain = emails.filter((email) => isCompanyDomainEmail(email, domain));
  const seen = new Set<string>();
  const unique = ownDomain.filter((email) => {
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  const personal = unique.filter((email) => !GENERIC_LOCAL_PARTS.has(email.split("@")[0]));
  const generic = unique.filter((email) => GENERIC_LOCAL_PARTS.has(email.split("@")[0]));
  const ordered = [...personal, ...generic];

  return ordered.map((email, idx) => ({
    email,
    confidence: personal.includes(email) ? 0.98 : 0.9 - idx * 0.01,
    reason: "Found directly on public company pages",
  }));
}

// A harvested email may belong to a colleague listed on the same page; only
// treat it as the requested person's email if the local-part relates to their name.
function hasNameAffinity(email: string, name: ParsedName): boolean {
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (!localPart) return false;

  const stripSymbols = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const segments = localPart.split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = name.tokens.map(stripSymbols).filter((t) => t.length >= 2);
  if (segments.some((segment) => tokens.includes(segment))) return true;

  const first = stripSymbols(name.first);
  const last = stripSymbols(name.last);
  const compact = stripSymbols(localPart);
  const combos = [
    first && last ? `${first}${last}` : "",
    first && last ? `${last}${first}` : "",
    name.firstInitial && last ? `${name.firstInitial}${last}` : "",
    first && last ? `${first}${last[0]}` : "",
  ].filter(Boolean);
  return combos.includes(compact);
}

function mergeRealCandidates(domain: string, name: ParsedName, ...emailLists: string[][]) {
  return Array.from(new Map(
    emailLists
      .flatMap((emails) => toRealEmailCandidates(emails, domain))
      .filter((c) => hasNameAffinity(c.email, name))
      .map((c) => [c.email.toLowerCase(), c])
  ).values());
}

function sourceHintCandidates(emails: string[], name: ParsedName) {
  const unique = Array.from(new Set(emails.map((email) => email.toLowerCase()).filter(Boolean)));
  return unique
    .filter((email) => hasNameAffinity(email, name))
    .map((email) => ({
      email,
      confidence: 0.98,
      reason: "Found directly on provided public source URL with person-name affinity",
    }))
    .sort((a, b) => b.confidence - a.confidence || a.email.localeCompare(b.email));
}

function emptyResearchSignals(): ResearchSignals {
  return {
    people_pages: [],
    publication_pages: [],
    github_urls: [],
    arxiv_urls: [],
    signal_emails: [],
    sources_checked: [],
  };
}

export async function orchestrate(userId: string, rawInput: unknown): Promise<EmailEnrichResult> {
  try {
    const parsed = emailEnrichInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        status: "error",
        candidates: [],
        evidence: unknownEvidence(),
        next_best_action: "Invalid input. Please provide person_name and company_name.",
      };
    }

    const input: EmailEnrichInput = parsed.data;
    const ip = deriveClientIp(userId, rawInput);
    const userLimit = emailEnrichRateLimiter.checkUserLimit(userId);
    const ipLimit = emailEnrichRateLimiter.checkIPLimit(ip);
    if (!userLimit.allowed || !ipLimit.allowed) {
      return {
        status: "rate_limited",
        candidates: [],
        evidence: unknownEvidence(),
        next_best_action: "Rate limit exceeded. Please retry later.",
      };
    }
    emailEnrichRateLimiter.recordUsage(userId, ip);

    const parsedName = parsePersonName(input.person_name);
    const sourceUrls = Array.from(new Set((input.hints?.source_urls ?? []).filter(Boolean))).slice(0, 12);
    const hintHarvest = sourceUrls.length
      ? await harvestPublicSourceUrls({ source_urls: sourceUrls })
      : { emails: [] as string[], sources_checked: [] as string[], pages_fetched: 0 };
    const hintedCandidates = sourceHintCandidates(hintHarvest.emails, parsedName);

    // Public profile URLs are a first-class source. This path intentionally
    // works without a company domain so a no-website business can still return
    // a real email published on a bar, court, directory, or docket page.
    if (hintedCandidates.length) {
      const best = hintedCandidates[0]!;
      return {
        status: "ok",
        best_email: best.email,
        confidence: best.confidence,
        candidates: hintedCandidates.slice(0, 12),
        evidence: {
          ...unknownEvidence(),
          sources_checked: hintHarvest.sources_checked,
          found_public_emails: hintHarvest.emails,
        },
      };
    }
    if (input.real_only && hintHarvest.emails.length) {
      return {
        status: "not_found",
        candidates: [],
        evidence: {
          ...unknownEvidence(),
          sources_checked: hintHarvest.sources_checked,
          found_public_emails: hintHarvest.emails,
        },
        next_best_action: "Public source emails were found, but none matched the requested person strongly enough.",
      };
    }

    const domainResolution = await resolveCompanyDomain(input);
    if (!domainResolution) {
      return {
        status: "needs_user_input",
        candidates: [],
        evidence: {
          ...unknownEvidence(),
          sources_checked: hintHarvest.sources_checked,
          found_public_emails: hintHarvest.emails,
        },
        next_best_action: "No email was found on the supplied public sources. Provide a company domain or another public profile URL.",
      };
    }

    const domain = domainResolution.domain;
    const emailsKey = `${input.mode}:${domain}`;
    const patternKey = `${input.mode}:${domain}`;

    const cachedEmails = domainEmailsCache.get(emailsKey);
    const harvest = cachedEmails ?? await harvestPublicEmails({ domain, mode: input.mode });
    if (!cachedEmails) {
      domainEmailsCache.set(emailsKey, harvest, ENRICH_CONFIG.cacheTtlDays * 24 * 60 * 60 * 1000);
    }

    const cachedPattern = domainPatternCache.get(patternKey);
    let researchSignals: ResearchSignals = emptyResearchSignals();
    if (input.use_case === "ai_research") {
      researchSignals = await collectResearchSignals(domain);
    }
    let teamSignals = { sources_checked: [] as string[], founder_mentioned: false };
    if (!input.real_only) {
      teamSignals = await collectTeamSignals(domain, input.person_name);
    }

    const mergedEmails = Array.from(new Set([...harvest.emails, ...researchSignals.signal_emails]));
    const pattern = cachedPattern ?? inferEmailPattern({ emails: mergedEmails, domain });
    if (!cachedPattern) {
      domainPatternCache.set(patternKey, pattern, ENRICH_CONFIG.cacheTtlDays * 24 * 60 * 60 * 1000);
    }

    const makeEvidence = (overrides?: {
      teamSources?: string[];
      verification?: VerificationResult;
      verificationAttempts?: VerificationAttempt[];
    }) =>
      buildEvidence({
        domain,
        harvestSources: harvest.sources_checked,
        researchSources: researchSignals.sources_checked,
        teamSources: overrides?.teamSources ?? teamSignals.sources_checked,
        mergedEmails,
        pattern: pattern.pattern,
        verification: overrides?.verification,
        verificationAttempts: overrides?.verificationAttempts,
        peoplePages: researchSignals.people_pages,
        publicationPages: researchSignals.publication_pages,
        githubUrls: researchSignals.github_urls,
        arxivUrls: researchSignals.arxiv_urls,
        signalEmails: researchSignals.signal_emails,
      });

    // Always prioritize real/harvested emails for cold outreach scenarios,
    // but only those attributable to the requested person by name.
    const mergedRealCandidates = mergeRealCandidates(domain, parsedName, harvest.emails, researchSignals.signal_emails);

    // For cold email outreach, real emails are strongly preferred
    if (mergedRealCandidates.length > 0) {
      return {
        status: "ok",
        best_email: mergedRealCandidates[0].email,
        confidence: mergedRealCandidates[0].confidence,
        candidates: mergedRealCandidates.slice(0, 12),
        evidence: makeEvidence({ teamSources: [] }),
      };
    }

    if (input.real_only) {
      return {
        status: "not_found",
        candidates: [],
        evidence: makeEvidence({ teamSources: [] }),
        next_best_action: "No real email was found on public pages for this domain.",
      };
    }

    // For cold_outreach use case, use strict mode to avoid false positives
    const enrichMode = input.use_case === "cold_outreach" ? "strict" : input.mode;

    const candidates = generateEmailCandidates({
      name: parsedName,
      domain,
      domainConfidence: domainResolution.confidence,
      pattern,
      foundEmails: mergedEmails,
      mode: enrichMode,
      founderMentionedOnTeamPage: teamSignals.founder_mentioned,
    });

    if (candidates.length === 0) {
      const mergedRealCandidates = mergeRealCandidates(domain, parsedName, harvest.emails, researchSignals.signal_emails);
      if (mergedRealCandidates.length > 0) {
        return {
          status: "ok",
          best_email: mergedRealCandidates[0].email,
          confidence: mergedRealCandidates[0].confidence,
          candidates: mergedRealCandidates.slice(0, 12),
          evidence: makeEvidence(),
        };
      }
      return {
        status: "not_found",
        candidates: [],
        evidence: makeEvidence(),
        next_best_action: "Could not infer a confident personal email. Provide known domain or role hints.",
      };
    }

    let verification: VerificationResult = { method: "none", result: "unknown" };
    const verificationAttempts: VerificationAttempt[] = [];
    const topN = input.mode === "strict" ? 3 : ENRICH_CONFIG.maxVerificationsPerRequest;

    if (input.mode !== "fast") {
      const toVerify = candidates.slice(0, topN);
      const verificationMap = new Map<string, VerificationResult["result"]>();
      for (const candidate of toVerify) {
        const result = await verifyEmailViaSmtp(candidate.email);
        verification = result;
        verificationAttempts.push({
          email: candidate.email,
          method: result.method,
          result: result.result,
        });
        verificationMap.set(candidate.email.toLowerCase(), result.result);
        if (result.result === "valid") {
          candidate.confidence = Math.min(1, candidate.confidence + 0.2);
        }
        if (result.result === "invalid") {
          candidate.confidence = Math.max(0, candidate.confidence - 0.4);
        }
        if (result.result === "catch_all") {
          candidate.confidence = Math.max(0, candidate.confidence - 0.1);
        }
      }

      if (verificationAttempts.length > 0 && verificationAttempts.every((a) => a.result === "invalid")) {
        return {
          status: "not_found",
          candidates: [],
          evidence: makeEvidence({
            verification: { method: "smtp_probe", result: "invalid" },
            verificationAttempts,
          }),
          next_best_action: "SMTP verification marked top candidates invalid. Provide a known profile/source URL.",
        };
      }

      // SMTP-based filtering: remove explicitly invalid candidates first.
      const filtered = candidates.filter((candidate) => {
        const status = verificationMap.get(candidate.email.toLowerCase());
        return status !== "invalid";
      });
      if (filtered.length > 0) {
        candidates.length = 0;
        candidates.push(...filtered);
      }

      const allResults = verificationAttempts.map((a) => a.result);
      if (allResults.length > 0) {
        if (allResults.includes("valid")) {
          verification = { method: "smtp_probe", result: "valid" };
        } else if (allResults.every((r) => r === "invalid")) {
          verification = { method: "smtp_probe", result: "invalid" };
        } else if (allResults.includes("catch_all")) {
          verification = { method: "smtp_probe", result: "catch_all" };
        } else {
          verification = { method: "smtp_probe", result: "unknown" };
        }
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];

    return {
      status: "ok",
      best_email: best?.email,
      confidence: best?.confidence ?? 0,
      candidates,
      evidence: makeEvidence({ verification, verificationAttempts }),
    };
  } catch {
    return {
      status: "error",
      candidates: [],
      evidence: unknownEvidence(),
      next_best_action: "Email enrichment failed unexpectedly. Please retry with company_domain.",
    };
  }
}

export * from "./types";

export { harvestPublicEmails, harvestPublicSourceUrls } from "./harvest";
