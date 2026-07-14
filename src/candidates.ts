import type { EmailCandidate, EnrichMode, ParsedName, PatternResult } from "./types";
import { GENERIC_LOCAL_PARTS } from "./constants";

const patternBaseFrequency: Record<string, number> = {
  "first.last": 1.0,
  "first": 0.75,
  "firstlast": 0.7,
  "f.last": 0.65,
  "flast": 0.6,
  "firstl": 0.55,
  "last.first": 0.45,
  "last": 0.35,
};

function applyPattern(pattern: string, name: ParsedName, domain: string): string | null {
  const first = name.first?.toLowerCase() ?? "";
  const last = name.last?.toLowerCase() ?? "";
  const fi = name.firstInitial?.toLowerCase() ?? "";

  if (!first) return null;

  switch (pattern) {
    case "first.last":
      if (!last) return null;
      return `${first}.${last}@${domain}`;
    case "first":
      return `${first}@${domain}`;
    case "firstlast":
      if (!last) return null;
      return `${first}${last}@${domain}`;
    case "f.last":
      if (!last || !fi) return null;
      return `${fi}.${last}@${domain}`;
    case "flast":
      if (!last || !fi) return null;
      return `${fi}${last}@${domain}`;
    case "firstl":
      if (!last) return null;
      return `${first}${last[0] ?? ""}@${domain}`;
    case "last.first":
      if (!last) return null;
      return `${last}.${first}@${domain}`;
    case "last":
      if (!last) return null;
      return `${last}@${domain}`;
    default:
      return null;
  }
}

function normalizeScore(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(3))));
}

export function generateEmailCandidates(input: {
  name: ParsedName;
  domain: string;
  domainConfidence: number;
  pattern: PatternResult;
  foundEmails: string[];
  mode: EnrichMode;
  founderMentionedOnTeamPage?: boolean;
}): EmailCandidate[] {
  if (!input.domain) return [];

  const candidateMap = new Map<string, EmailCandidate>();
  const allPatterns = Object.keys(patternBaseFrequency);
  const foundSet = new Set(input.foundEmails.map((e) => e.toLowerCase()));

  for (const pattern of allPatterns) {
    const email = applyPattern(pattern, input.name, input.domain);
    if (!email) continue;
    const local = email.split("@")[0].toLowerCase();
    const isGeneric = GENERIC_LOCAL_PARTS.has(local);
    const inferred = input.pattern.pattern === pattern && input.pattern.confidence >= 0.4;

    // For cold outreach, heavily favor inferred patterns from real data
    const base = inferred ? input.pattern.confidence * 0.95 : patternBaseFrequency[pattern] * 0.25;

    const directEvidence = foundSet.has(email.toLowerCase()) ? 0.3 : 0;  // Boost real evidence
    const genericPenalty = isGeneric ? 0.25 : 0;  // Increase penalty for generic emails
    const personPatternBonus = input.founderMentionedOnTeamPage && ["first.last", "first", "f.last", "flast", "firstlast"].includes(pattern)
      ? 0.15  // Boost founder pattern recognition
      : 0;

    const score = normalizeScore(
      base * input.domainConfidence * input.name.confidence +
      directEvidence +
      personPatternBonus -
      genericPenalty
    );

    const reason = inferred
      ? `Inferred from pattern ${pattern}@ (${input.pattern.sample_count} real emails found)`
      : `Generated from pattern ${pattern}@`;

    const existing = candidateMap.get(email);
    if (!existing || score > existing.confidence) {
      candidateMap.set(email, { email, confidence: score, reason });
    }
  }

  let candidates = Array.from(candidateMap.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);

  if (input.mode !== "strict") {
    // For cold outreach (default mode), only keep high-confidence candidates
    candidates = candidates
      .filter((c) => c.confidence >= 0.4)  // Minimum threshold
      .slice(0, Math.max(3, Math.min(5, candidates.length)));  // Reduce to 3-5 instead of 5-8
  }

  if (input.mode === "strict") {
    // Strict mode: only very high confidence (0.6+)
    candidates = candidates.filter((c) => c.confidence >= 0.6);
  }

  return candidates;
}
