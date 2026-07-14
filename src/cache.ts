import type { CacheEntry } from "./types";
import type { HarvestResult, PatternResult, VerificationResult } from "./types";

export class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize: number = 1000, defaultTTLMs: number = 7 * 24 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTLMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.cache.set(key, {
      data: value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL),
    });
    this.evict();
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }
}

const DAY = 24 * 60 * 60 * 1000;

export const domainPatternCache = new TTLCache<PatternResult>(500, 7 * DAY);
export const domainEmailsCache = new TTLCache<HarvestResult>(500, 7 * DAY);
export const verificationCache = new TTLCache<VerificationResult>(2000, 7 * DAY);
export const mxRecordCache = new TTLCache<string>(500, DAY);
export const catchAllCache = new TTLCache<boolean>(500, 7 * DAY);
