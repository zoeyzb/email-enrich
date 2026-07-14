import { promises as dns } from "dns";
import net from "net";
import { ENRICH_CONFIG } from "./constants";
import { catchAllCache, mxRecordCache, verificationCache } from "./cache";
import type { VerificationResult } from "./types";

const domainProbeTimestamps = new Map<string, number[]>();

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const smtpSemaphore = new Semaphore(ENRICH_CONFIG.smtpConcurrency);

function parseCode(line: string): number | null {
  const match = line.match(/^(\d{3})/);
  if (!match) return null;
  return Number(match[1]);
}

function waitForSmtpCode(socket: net.Socket, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("smtp timeout"));
    }, timeoutMs);

    const onData = (buf: Buffer) => {
      const text = buf.toString("utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const code = parseCode(line.trim());
        if (code) {
          cleanup();
          resolve(code);
          return;
        }
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function sendAndReadCode(socket: net.Socket, command: string): Promise<number> {
  socket.write(command);
  return waitForSmtpCode(socket, ENRICH_CONFIG.smtpTimeoutMs);
}

function checkDomainProbeLimit(domain: string): boolean {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const current = (domainProbeTimestamps.get(domain) ?? []).filter((ts) => ts > fiveMinAgo);
  if (current.length >= 2) {
    domainProbeTimestamps.set(domain, current);
    return false;
  }
  current.push(now);
  domainProbeTimestamps.set(domain, current);
  return true;
}

async function resolveMxHost(domain: string): Promise<string | null> {
  const cacheKey = `mx:${domain}`;
  const cached = mxRecordCache.get(cacheKey);
  if (cached) return cached;

  try {
    const records = await dns.resolveMx(domain);
    if (records.length > 0) {
      const host = records.sort((a, b) => a.priority - b.priority)[0].exchange;
      mxRecordCache.set(cacheKey, host, 24 * 60 * 60 * 1000);
      return host;
    }
  } catch {
    // fallback below
  }

  try {
    await dns.resolve4(domain);
    mxRecordCache.set(cacheKey, domain, 24 * 60 * 60 * 1000);
    return domain;
  } catch {
    return null;
  }
}

async function probeRcpt(email: string): Promise<number | null> {
  const domain = email.split("@")[1];
  if (!domain || !checkDomainProbeLimit(domain)) return null;

  const host = await resolveMxHost(domain);
  if (!host) return null;

  return smtpSemaphore.withLock(async () => {
    return new Promise<number | null>((resolve) => {
      const socket = net.createConnection({ host, port: 25 });
      socket.setTimeout(ENRICH_CONFIG.smtpTimeoutMs);

      const fail = () => {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve(null);
      };

      socket.on("timeout", fail);
      socket.on("error", fail);

      socket.on("connect", async () => {
        try {
          const greet = await waitForSmtpCode(socket, ENRICH_CONFIG.smtpTimeoutMs);
          if (greet !== 220) return fail();
          const ehlo = await sendAndReadCode(socket, "EHLO pulse-verify.local\r\n");
          if (Math.floor(ehlo / 100) !== 2) return fail();
          const mailFrom = await sendAndReadCode(socket, "MAIL FROM:<verify@pulse-verify.local>\r\n");
          if (Math.floor(mailFrom / 100) !== 2) return fail();
          const rcpt = await sendAndReadCode(socket, `RCPT TO:<${email}>\r\n`);
          socket.write("QUIT\r\n");
          socket.end();
          resolve(rcpt);
        } catch {
          fail();
        }
      });
    });
  });
}

function randomCatchAllEmail(domain: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `__pulse_catchall_test__${random}@${domain}`;
}

function mapCodeToResult(code: number | null): VerificationResult["result"] {
  if (code === null) return "unknown";
  if (code === 250) return "valid";
  if ([550, 551, 552, 553, 554].includes(code)) return "invalid";
  if ([450, 451, 452].includes(code)) return "unknown";
  return "unknown";
}

export async function verifyEmailViaSmtp(email: string): Promise<VerificationResult> {
  const key = `smtp:${email.toLowerCase()}`;
  const cached = verificationCache.get(key);
  if (cached) return cached;

  try {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return { method: "smtp_probe", result: "unknown" };

    const catchAllKey = `catchall:${domain}`;
    const cachedCatchAll = catchAllCache.get(catchAllKey);
    if (cachedCatchAll === true) {
      const result: VerificationResult = { method: "smtp_probe", result: "catch_all" };
      verificationCache.set(key, result);
      return result;
    }

    if (cachedCatchAll === undefined) {
      const catchAllCode = await probeRcpt(randomCatchAllEmail(domain));
      if (catchAllCode === 250) {
        catchAllCache.set(catchAllKey, true, 7 * 24 * 60 * 60 * 1000);
        const result: VerificationResult = { method: "smtp_probe", result: "catch_all" };
        verificationCache.set(key, result);
        return result;
      }
      catchAllCache.set(catchAllKey, false, 7 * 24 * 60 * 60 * 1000);
    }

    const code = await probeRcpt(email);
    const result: VerificationResult = {
      method: "smtp_probe",
      result: mapCodeToResult(code),
    };
    verificationCache.set(key, result);
    return result;
  } catch {
    return { method: "smtp_probe", result: "unknown" };
  }
}
