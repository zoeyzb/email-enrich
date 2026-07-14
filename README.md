# email-enrich

Find and verify professional email addresses **without a paid data API**. `email-enrich` resolves a company domain, harvests emails that are already published on the company's public pages, infers the organization's naming pattern, generates candidates for the person you're looking for, and optionally verifies them over SMTP — returning ranked candidates with an evidence trail.

It includes a **name-affinity guard**: a harvested address is only promoted to `best_email` when its local-part actually relates to the requested person's name, so a colleague's address scraped off the same team page is never returned as the target's email.

> ⚠️ **Use responsibly.** This library scrapes public web pages and can open SMTP connections to mail servers. You are responsible for complying with the terms of service of the sites you crawl, the acceptable-use policies of the mail servers you probe, and applicable privacy/anti-spam laws (GDPR, CAN-SPAM, etc.). SMTP verification is disabled by design in `fast` mode. See [Responsible use](#responsible-use).

## Features

- **No API keys.** Works entirely from public pages, DNS, and SMTP.
- **Domain resolution** from a domain, a website URL, or (optionally) a DNS-based guess from the company name.
- **Public-email harvesting** across common company paths, sitemaps, `robots.txt`/`humans.txt`/`security.txt`, with `mailto:` extraction, `[at]`/`[dot]` de-obfuscation, and Cloudflare email-protection decoding.
- **Pattern inference** (`first.last`, `flast`, `f.last`, …) from the real emails found on the domain.
- **Candidate generation** scored by pattern confidence, direct evidence, and generic-address penalties.
- **Name-affinity guard** so harvested addresses are attributed to the right person.
- **SMTP verification** with MX resolution, catch-all detection, per-domain probe throttling, and bounded concurrency.
- **Built-in TTL caching** and **rate limiting** (per user, per IP).
- Fully typed, dependency-light (`cheerio`, `zod`), and tested with Jest.

## Install

```bash
npm install email-enrich
# or
pnpm add email-enrich
```

Requires **Node.js 18+** (uses the global `fetch`/`AbortController`).

## Usage

```ts
import { orchestrate } from "email-enrich";

const result = await orchestrate("user-123", {
  person_name: "John Smith",
  company_name: "Acme Corp",
  company_domain: "acme.com", // preferred; or pass company_website
  mode: "default",            // "default" | "strict" | "fast"
  use_case: "cold_outreach",  // "general" | "ai_research" | "vc" | "sales" | "cold_outreach"
});

if (result.status === "ok") {
  console.log(result.best_email, result.confidence);
  console.log(result.candidates);   // ranked EmailCandidate[]
  console.log(result.evidence);     // domain, sources checked, pattern, verification, ...
}
```

The first argument is a caller identifier used for rate limiting (e.g. a user id or request key).

### Input

Validated with a [zod](https://zod.dev) schema (`emailEnrichInputSchema`):

| Field             | Type                                                                   | Default     | Notes                                                            |
| ----------------- | ---------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `person_name`     | `string`                                                               | —           | Full name, e.g. `"John Smith"`.                                 |
| `company_name`    | `string`                                                               | —           | e.g. `"Acme Corp"`.                                             |
| `company_domain`  | `string`                                                               | `""`        | Preferred over `company_website`.                               |
| `company_website` | `string`                                                               | `""`        | Domain is extracted if `company_domain` is absent.              |
| `hints`           | `{ role?: string; source_urls?: string[] }`                            | `{}`        | Optional role/source hints.                                     |
| `mode`            | `"default" \| "strict" \| "fast"`                                      | `"default"` | `strict` = no low-confidence guessing; `fast` = skip SMTP.      |
| `real_only`       | `boolean`                                                              | `false`     | Only return addresses actually found on public pages.           |
| `use_case`        | `"general" \| "ai_research" \| "vc" \| "sales" \| "cold_outreach"`     | `"general"` | Tunes signal collection and ranking.                            |

### Output

```ts
interface EmailEnrichResult {
  status: "ok" | "not_found" | "needs_user_input" | "rate_limited" | "error";
  best_email?: string;
  confidence?: number;
  candidates: EmailCandidate[]; // { email, confidence, reason }
  evidence: {
    domain: string;
    sources_checked: string[];
    found_public_emails: string[];
    pattern_inferred: string;
    verification: { method: string; result: string };
    verification_attempts?: { email: string; method: string; result: string }[];
    // research signals (ai_research use case): people_pages, publication_pages, github_urls, arxiv_urls, signal_emails
  };
  next_best_action?: string;
}
```

## How it works

```
resolveCompanyDomain → harvestPublicEmails ─┐
                                            ├─► name-affinity guard ─► real harvested match? ─► return
         (ai_research) collectResearchSignals┘                                    │ no
                                                                                  ▼
                              inferEmailPattern → generateEmailCandidates → verifyEmailViaSmtp → rank → return
```

If a name-matching address is harvested from the company's own pages, it wins immediately. Otherwise the library infers the domain's naming pattern from whatever real emails it found and generates verified candidates for the requested person.

## Configuration

All optional; sensible defaults are used when unset.

| Env var                                    | Default | Description                                    |
| ------------------------------------------ | ------: | ---------------------------------------------- |
| `EMAIL_ENRICH_USER_DAILY_LIMIT`            |    `50` | Max enrichments per caller id per day.         |
| `EMAIL_ENRICH_IP_MINUTE_LIMIT`             |    `10` | Max enrichments per IP per minute.             |
| `EMAIL_ENRICH_SMTP_CONCURRENCY`            |     `3` | Concurrent SMTP probes.                        |
| `EMAIL_ENRICH_MAX_VERIFICATIONS_PER_REQUEST` | `6`   | Candidates verified per request.               |
| `EMAIL_ENRICH_FETCH_TIMEOUT_MS`            |  `8000` | Per-page fetch timeout.                        |
| `EMAIL_ENRICH_SMTP_TIMEOUT_MS`             | `10000` | SMTP socket timeout.                           |
| `EMAIL_ENRICH_CACHE_TTL_DAYS`              |     `7` | TTL for harvested emails / inferred patterns.  |
| `EMAIL_ENRICH_MAX_PAGES_PER_DOMAIN`        |    `60` | Crawl budget per domain.                       |
| `EMAIL_ENRICH_ENABLE_DNS_GUESS`            | `false` | Allow guessing the domain from company name.   |

The caches and rate limiter are in-memory and per-process. Swap them out if you need shared/distributed state.

## Testing

```bash
npm install
npm test
```

## Responsible use

- Respect `robots.txt` and site terms of service when harvesting.
- SMTP `RCPT` probing can be treated as abusive by some providers; probes are throttled per domain and skipped in `fast` mode. Consider running verification from an IP with proper reverse DNS.
- Only process personal data where you have a lawful basis, and honor opt-outs and anti-spam law before sending outreach.

## License

[MIT](./LICENSE) © waterdoog
