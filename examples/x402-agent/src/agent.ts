// Minimal x402 v2 agent (custom scheme `turnspike-allowance`).
//
// createX402Fetch wraps the official @x402/fetch wrapper with the turnspike-allowance client scheme. It pays only:
//   - a payee on the agent's allowlist (origin -> merchant), at or below the agent's price ceiling,
//   - on the trusted chain, contract and token,
//   - inside the owner's on-chain limits (per-call cap, daily cap, merchant allowlist, not paused).
// A failed call reports `paid` / `maybePaid`. Calling again with the same request (same purchase key) resumes the
// purchase; it never pays the same purchase twice.
import type { Signer } from "ethers";
import { TurnspikeClient, FileJournal, MemoryJournal, type Journal } from "@turnspike-qie/client";
import { createX402Fetch, FileProofStore, MemoryProofStore } from "@turnspike-qie/x402";

export interface AgentConfig {
  /** The AGENT signer authorised by the owner on the vault. Never the owner's key. */
  signer: Signer;
  owner: string;
  rpcUrl: string;
  chainId: number;
  contract: string;
  token: string;
  /** Who the agent may pay: the seller's origin and its merchant address. */
  payees: { origin: string; merchant: string }[];
  /** Per-request ceiling in base units (6 decimals). */
  maxPriceBase: bigint;
  /** Files for restart safety. Omit both for in-memory state (no restart safety). */
  journalPath?: string;
  proofStorePath?: string;
  confirmations?: number;
  /** Injected fetch (tests, proxies) and re-presentation retry settings, passed to createX402Fetch. */
  fetch?: typeof fetch;
  retry?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; totalMs?: number };
}

export async function createAgent(cfg: AgentConfig) {
  const journal: Journal = cfg.journalPath ? new FileJournal(cfg.journalPath) : new MemoryJournal();
  const client = new TurnspikeClient({
    signer: cfg.signer,
    owner: cfg.owner,
    network: { name: "local", chainId: cfg.chainId, contract: cfg.contract, token: cfg.token, decimals: 6, rpcUrls: [cfg.rpcUrl], explorer: "http://localhost" },
    policy: { payees: cfg.payees, maxPriceBase: cfg.maxPriceBase },
    journal,
    confirmations: cfg.confirmations ?? 2,
  });
  const proofStore = cfg.proofStorePath ? new FileProofStore(cfg.proofStorePath) : new MemoryProofStore();
  const pay = createX402Fetch({
    client: client as any, // TurnspikeClient satisfies the PayChallengeClient interface structurally
    journal: journal as any,
    owner: cfg.owner,
    agent: await cfg.signer.getAddress(),
    network: { chainId: cfg.chainId, token: cfg.token },
    maxPriceBase: cfg.maxPriceBase,
    proofStore,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    ...(cfg.retry ? { retry: cfg.retry } : {}),
  });
  return { client, journal, proofStore, pay };
}
