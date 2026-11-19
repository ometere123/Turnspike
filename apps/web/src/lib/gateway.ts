import { config } from "./config";

/**
 * Typed boundary to the Turnpike gateway (apps/gateway). Every call returns a Result so the UI can show a truthful
 * unavailable state. Nothing here fabricates data.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; body?: Record<string, unknown> };

export interface GatewayConfig {
  chainId: number; contract: string; token: string; merchant: string; priceBase: string; priceAddressBase: string;
  confirmations: number; demoEnabled: boolean; explorer: string;
}
export interface GatewayStats { delivered: number; deliveredOwn: number; deliveredExternal: number; paidUndelivered24h: number }
export interface Challenge {
  error: "payment_required"; requestId: string; sig: string; priceBase: string; token: string; contract: string;
  merchant: string; chainId: number; resourceId: string; expiresAt: number;
}
export interface RunStep { step: string; ok: boolean; txHash?: string; detail?: unknown }
export interface RunResult { steps: RunStep[]; data?: { blockNumber: number; timestamp: number; txCount: number; chainId: number; source: string } }
export type Scenario = "allowed" | "over-cap" | "replay" | "unauthorized-merchant";
export type DemoStatus =
  | { enabled: false }
  | { enabled: true; runsLast24h: number; txBudgetRemaining: number; txBudget: number; perIpHour: number; perIpDay: number; powBits: number; agentGasOk: boolean | null };
export interface PowChallenge { token: string; bits: number; expires: number }

async function call<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Result<T>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(config.gatewayUrl + path, { ...init, signal: ctl.signal, cache: "no-store" });
    const body = await r.json().catch(() => null);
    if (!r.ok && r.status !== 402) return { ok: false, error: (body as { error?: string } | null)?.error ?? `HTTP ${r.status}`, status: r.status, body: body ?? undefined };
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: (e as Error)?.name === "AbortError" ? "Gateway timed out" : "Gateway unreachable" };
  } finally { clearTimeout(t); }
}

/** Finds a nonce so that sha256(`${salt}:${nonce}`) has at least `bits` leading zero bits. Yields to the UI regularly. */
export async function solvePow(token: string, bits: number): Promise<string> {
  const salt = token.split(".")[0];
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${n}`)));
    let z = 0;
    for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return String(n);
    if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

export const gateway = {
  config: () => call<GatewayConfig>("/v1/config"),
  stats: () => call<GatewayStats>("/v1/stats"),
  health: () => call<{ ok: boolean }>("/healthz"),
  demoStatus: () => call<DemoStatus>("/demo/status"),
  demoChallenge: () => call<PowChallenge>("/demo/challenge"),
  /** An unpaid request: the real 402 challenge. */
  probe: () => call<Challenge>("/v1/block-summary"),
  /** Runs the gateway's scripted agent (real mainnet transactions within the demo owner's on-chain limits). Needs a solved puzzle. */
  run: (s: Scenario, pow: string) => call<RunResult>(`/demo/run/${s}`, { method: "POST", headers: { "x-demo-pow": pow } }, 150_000),
};
