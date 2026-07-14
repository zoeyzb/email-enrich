import type { ParsedName } from "./types";

const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);

function normalizeToken(token: string): string {
  return token
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\-']/g, "")
    .toLowerCase()
    .trim();
}

export function parsePersonName(fullName: string): ParsedName {
  const rawTokens = fullName.split(/\s+/).map((t) => normalizeToken(t)).filter(Boolean);
  const filtered = rawTokens.filter((token, idx) => {
    if (idx === 0 && TITLES.has(token.replace(/\./g, ""))) return false;
    if (SUFFIXES.has(token.replace(/\./g, ""))) return false;
    return true;
  });

  const tokens = filtered.flatMap((token) => token.split("-")).filter(Boolean);
  const first = filtered[0] ?? "";
  const last = filtered.length <= 1 ? "" : (filtered[filtered.length - 1] ?? "");
  const confidence = first && last ? 1 : 0.6;

  return {
    first,
    last,
    firstInitial: first[0] ?? "",
    tokens,
    confidence,
  };
}
