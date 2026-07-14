export const COMPANY_PAGE_PATHS_BASE = ["/", "/about", "/contact"] as const;
export const COMPANY_PAGE_PATHS_FULL = [
  ...COMPANY_PAGE_PATHS_BASE,
  "/team",
  "/people",
  "/company",
  "/press",
  "/about-us",
  "/contact-us",
  "/impressum",
  "/legal",
  "/privacy",
  "/investors",
  "/portfolio",
  "/our-team",
  "/who-we-are",
] as const;

export const EXTRA_LINK_HINTS = [
  "/about",
  "/team",
  "/contact",
  "/people",
  "/staff",
  "/who-we-are",
  "/our-team",
  "/impressum",
  "/legal",
  "/privacy",
  "/investors",
  "/portfolio",
] as const;

export const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "contact",
  "hello",
  "support",
  "team",
  "sales",
  "marketing",
  "admin",
  "hr",
  "office",
  "press",
  "media",
  "careers",
  "jobs",
  "legal",
]);

export const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "test.com",
  "sentry.io",
  "wixpress.com",
]);

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"];

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const ENRICH_CONFIG = {
  userDailyLimit: envNumber("EMAIL_ENRICH_USER_DAILY_LIMIT", 50),
  ipMinuteLimit: envNumber("EMAIL_ENRICH_IP_MINUTE_LIMIT", 10),
  smtpConcurrency: envNumber("EMAIL_ENRICH_SMTP_CONCURRENCY", 3),
  maxVerificationsPerRequest: envNumber("EMAIL_ENRICH_MAX_VERIFICATIONS_PER_REQUEST", 6),
  fetchTimeoutMs: envNumber("EMAIL_ENRICH_FETCH_TIMEOUT_MS", 8000),
  smtpTimeoutMs: envNumber("EMAIL_ENRICH_SMTP_TIMEOUT_MS", 10000),
  cacheTtlDays: envNumber("EMAIL_ENRICH_CACHE_TTL_DAYS", 7),
  maxPagesPerDomain: envNumber("EMAIL_ENRICH_MAX_PAGES_PER_DOMAIN", 60),
  enableDnsGuess: process.env.EMAIL_ENRICH_ENABLE_DNS_GUESS === "true",
};
