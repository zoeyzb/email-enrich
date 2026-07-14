import { ENRICH_CONFIG } from "./constants";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  message?: string;
}

function cleanupOld(entries: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return entries.filter((ts) => ts > cutoff);
}

export class RateLimiter {
  private userDaily = new Map<string, number[]>();
  private ipMinute = new Map<string, number[]>();

  checkUserLimit(userId: string): RateLimitResult {
    const windowMs = 24 * 60 * 60 * 1000;
    const max = ENRICH_CONFIG.userDailyLimit;
    const current = cleanupOld(this.userDaily.get(userId) ?? [], windowMs);
    this.userDaily.set(userId, current);
    const allowed = current.length < max;
    return {
      allowed,
      remaining: Math.max(0, max - current.length),
      resetAt: Date.now() + windowMs,
      message: allowed ? undefined : "User daily limit exceeded",
    };
  }

  checkIPLimit(ip: string): RateLimitResult {
    const windowMs = 60 * 1000;
    const max = ENRICH_CONFIG.ipMinuteLimit;
    const current = cleanupOld(this.ipMinute.get(ip) ?? [], windowMs);
    this.ipMinute.set(ip, current);
    const allowed = current.length < max;
    return {
      allowed,
      remaining: Math.max(0, max - current.length),
      resetAt: Date.now() + windowMs,
      message: allowed ? undefined : "IP minute limit exceeded",
    };
  }

  recordUsage(userId: string, ip: string): void {
    const userEntries = cleanupOld(this.userDaily.get(userId) ?? [], 24 * 60 * 60 * 1000);
    userEntries.push(Date.now());
    this.userDaily.set(userId, userEntries);

    const ipEntries = cleanupOld(this.ipMinute.get(ip) ?? [], 60 * 1000);
    ipEntries.push(Date.now());
    this.ipMinute.set(ip, ipEntries);
  }
}

export const emailEnrichRateLimiter = new RateLimiter();
