import { config } from "./config";

/**
 * Typed boundary to the Turnpike gateway (apps/gateway). Every call returns a Result so the UI can show a truthful
 * unavailable state. Nothing here fabricates data.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export interface GatewayConfig {
  chainId: number; contract: string; token: string; merchant: string; priceBase: string;
  confirmations: number; demoEnabled: boolean; explorer: string;
}
export interface GatewayStats { delivered: number; deliveredOwn: number; deliveredExternal: number; paidUndelivered24h: number }
export interface Challenge {
  error: "payment_required"; requestId: string; sig: string; priceBase: string; token: string; contract: string;
  merchant: string; chainId: number; resourceId: string; expiresAt: number;
}
export interface RunStep { step: string; ok: boolean; txHash?: string; detail?: unknown }
export interface RunResult { steps: RunStep[]; data?: { blockNumber: number; timestamp: number; txCount: number; chainId: number; source: string } }
export type Scenario = "allowed" | "over-cap" | "replay" | "after-revoke";

async function call<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Result<T>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(config.gatewayUrl + path, { ...init, signal: ctl.signal, cache: "no-store" });
    const body = await r.json().catch(() => null);
    if (!r.ok && r.status !== 402) return { ok: false, error: (body as any)?.error ?? `HTTP ${r.status}`, status: r.status };
    return { ok: true, data: body as T };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "Gateway timed out" : "Gateway unreachable" };
  } finally { clearTimeout(t); }
}

export const gateway = {
  config: () => call<GatewayConfig>("/v1/config"),
  stats: () => call<GatewayStats>("/v1/stats"),
  health: () => call<{ ok: boolean }>("/healthz"),
  /** An unpaid request: the real 402 challenge. */
  probe: () => call<Challenge>("/v1/block-summary"),
  /** Runs the gateway's scripted agent (real mainnet transactions within the demo owner's on-chain limits). */
  run: (s: Scenario) => call<RunResult>(`/demo/run/${s}`, { method: "POST" }, 150_000),
};
