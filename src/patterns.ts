import { GENERIC_LOCAL_PARTS } from "./constants";
import type { PatternResult } from "./types";

const orderedPatterns: PatternResult["pattern"][] = [
  "first.last",
  "first",
  "firstlast",
  "f.last",
  "flast",
  "firstl",
  "last.first",
  "last",
];

function classifyLocalPart(local: string): PatternResult["pattern"] {
  if (/^[a-z]\.[a-z]+$/.test(local)) return "f.last";
  if (/^[a-z]+\.[a-z]+$/.test(local)) {
    const [left, right] = local.split(".");
    if (!left || !right) return "unknown";
    if (left.length === 1) return "f.last";
    // Heuristic: short right side likely "last.first" (e.g. smith.j)
    if (right.length <= 2 && left.length >= 3) return "last.first";
    return "first.last";
  }
  if (/^[a-z]{2,}$/.test(local)) {
    if (local.length <= 5) return "first";
    if (local.length <= 8) return "firstl";
    return "firstlast";
  }
  return "unknown";
}

export function inferEmailPattern(input: { emails: string[]; domain: string }): PatternResult {
  const suffix = `@${input.domain.toLowerCase()}`;
  const personalLocals = input.emails
    .map((e) => e.toLowerCase())
    .filter((email) => email.endsWith(suffix))
    .map((email) => email.split("@")[0])
    .filter((local) => !GENERIC_LOCAL_PARTS.has(local));

  if (personalLocals.length === 0) {
    return { pattern: "unknown", confidence: 0, sample_count: 0 };
  }

  const counts = new Map<PatternResult["pattern"], number>();
  for (const local of personalLocals) {
    const pattern = classifyLocalPart(local);
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }

  let bestPattern: PatternResult["pattern"] = "unknown";
  let bestCount = 0;
  for (const p of orderedPatterns) {
    const count = counts.get(p) ?? 0;
    if (count > bestCount) {
      bestPattern = p;
      bestCount = count;
    }
  }

  let confidence = 0.4;
  const sampleSize = personalLocals.length;
  if (bestCount >= 5) confidence = 0.95;
  else if (bestCount >= 3) confidence = 0.85;
  else if (bestCount >= 2) confidence = 0.7;

  // Penalty when dominant pattern is weak within sample set.
  const dominance = bestCount / Math.max(1, sampleSize);
  if (dominance < 0.5) confidence = Math.max(0.35, confidence - 0.2);
  else if (dominance < 0.7) confidence = Math.max(0.4, confidence - 0.1);

  return {
    pattern: bestPattern,
    confidence,
    sample_count: sampleSize,
  };
}
