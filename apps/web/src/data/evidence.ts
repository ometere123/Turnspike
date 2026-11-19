import { deploymentEvidence } from "@/lib/config";
import demo from "@/data/evidence-json/M4_mainnet_demo.json";
import integration from "@/data/evidence-json/M3_mainnet_integration.json";

/**
 * Evidence shown on /evidence. Every hash comes from a file saved under evidence/ in the repository; nothing is typed by hand
 * except the three live-demo hashes, copied verbatim from evidence/M5_live_demo_run.txt.
 */
export interface EvidenceTx { label: string; hash: string; outcome: "success" | "refused"; note: string; source: string }

const d = deploymentEvidence;

export const DEPLOY_TX: EvidenceTx = { label: "Contract deployment", hash: d.deployTx, outcome: "success", note: "TurnpikeAllowance, deposit cap 5 QUSDC", source: "evidence/deployment.json" };

export const SMOKE: EvidenceTx[] = [
  { label: "Approve QUSDC", hash: d.smokeTxs.approve, outcome: "success", note: "Owner approves 50,000 base units", source: "evidence/deployment.json" },
  { label: "Deposit", hash: d.smokeTxs.deposit, outcome: "success", note: "50,000 base units into the allowance", source: "evidence/deployment.json" },
  { label: "Set policy", hash: d.smokeTxs.setPolicy, outcome: "success", note: "Per-call 10,000, daily 30,000 base units", source: "evidence/deployment.json" },
  { label: "Allow merchant", hash: d.smokeTxs.setMerchant, outcome: "success", note: "Demo merchant allowlisted", source: "evidence/deployment.json" },
  { label: "Allowed payment", hash: d.smokeTxs.allowedPay, outcome: "success", note: "1,000 base units paid to the merchant", source: "evidence/deployment.json" },
  { label: "Over-cap payment", hash: d.smokeTxs.overCapRevert_CapExceeded, outcome: "refused", note: "Reverted with CapExceeded", source: "evidence/deployment.json" },
  { label: "Replay", hash: d.smokeTxs.replayRevert_RequestAlreadyUsed, outcome: "refused", note: "Reverted with RequestAlreadyUsed", source: "evidence/deployment.json" },
];

type Step = { step: string; txHash?: string; detail?: { name?: string } };
const steps = (k: keyof typeof demo): Step[] => ((demo[k] as { steps?: Step[] })?.steps ?? []) as Step[];
const pick = (k: keyof typeof demo, step: string) => steps(k).find((s) => s.step === step)?.txHash;

export const DEMO_RUN: EvidenceTx[] = [
  { label: "Allowed payment (agent through the gateway)", hash: pick("1_allowed", "pay submitted")!, outcome: "success", note: "Delivered live block data after confirmations", source: "evidence/M4_mainnet_demo.json" },
  { label: "Over-cap payment", hash: pick("2_over_cap", "over-cap pay")!, outcome: "refused", note: "CapExceeded, broadcast with a fixed gas limit", source: "evidence/M4_mainnet_demo.json" },
  { label: "Replayed request ID", hash: pick("3_replay", "re-use requestId on-chain")!, outcome: "refused", note: "RequestAlreadyUsed", source: "evidence/M4_mainnet_demo.json" },
  { label: "Owner revokes the agent", hash: demo["4_owner_revoke_tx"] as string, outcome: "success", note: "The next agent payment was refused with NotOwnerAgent (refused at submission, so it has no transaction)", source: "evidence/M4_mainnet_demo.json" },
  { label: "Owner restores the policy", hash: demo["6_owner_restores_policy_tx"] as string, outcome: "success", note: "", source: "evidence/M4_mainnet_demo.json" },
  { label: "Owner withdraws 1,000 base units", hash: demo["7_owner_withdraw_1000_tx"] as string, outcome: "success", note: "Withdrawal works while the owner controls the account", source: "evidence/M4_mainnet_demo.json" },
  { label: "Middleware against mainnet: paid call", hash: integration.payTx, outcome: "success", note: `Receipt in ${integration.receiptSeconds} s; gateway showed 202 pending, then 200`, source: "evidence/M3_mainnet_integration.json" },
];

export const SDK_RUN: EvidenceTx[] = [
  { label: "Agent SDK buys from the hosted gateway", hash: "0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7", outcome: "success", note: "examples/node-agent with @turnspike-qie/client: quote, pay, 2 confirmations, delivered in 15 s; rerun with the same key replayed without paying. 92,159 gas", source: "evidence/M8_sdk_mainnet.md" },
];

export const LIVE_DEMO_V2: EvidenceTx[] = [
  { label: "Hardened gateway: allowed call", hash: "0x92f17dcf8ca81ac124f16d6b836fff4bdb8a778f25efc00ee19b2a67e6dea4d6", outcome: "success", note: "Solved puzzle, paid, pending, delivered", source: "evidence/M7_live_demo.json" },
  { label: "Hardened gateway: replay refused", hash: "0x4092c6a833b48c65a263d27bd06f9753e1efab856ece5cee24ea300fa6de79cb", outcome: "refused", note: "RequestAlreadyUsed", source: "evidence/M7_live_demo.json" },
  { label: "Hardened gateway: over-cap refused", hash: "0x7b4414737c6ccfb74db7237dba65e8c7741dad6d34b1db167a2c33c1d0c7cff1", outcome: "refused", note: "CapExceeded", source: "evidence/M7_live_demo.json" },
];

export const LIVE_DEMO: EvidenceTx[] = [
  { label: "Live site: allowed call", hash: "0xc1459222ec2d0b0ec2ad7a4608c7bf90a8272bb53fdc5d320e9402017cdeba63", outcome: "success", note: "Run through the public gateway", source: "evidence/M5_live_demo_run.txt" },
  { label: "Live site: replay refused", hash: "0x31d80570fc297ece35679be19b116b09b6f7cbc20fc62c1079313c2a49891bad", outcome: "refused", note: "RequestAlreadyUsed", source: "evidence/M5_live_demo_run.txt" },
  { label: "Live site: over-cap refused", hash: "0x4ed0c8f8f47ef284e3cc52938e211047004c1543f224fbfa0476161c729c837e", outcome: "refused", note: "CapExceeded", source: "evidence/M5_live_demo_run.txt" },
];

export interface TestRecord { name: string; result: string; file: string }
export const TESTS: TestRecord[] = [
  { name: "Contract tests (TEST-C01 to C13, SEC-008 ABI check, token-conservation fuzz)", result: "15 passing; contract line coverage 100%, branch 87.5%", file: "evidence/M1_contract_tests.txt" },
  { name: "Middleware, gateway and demo-guard tests (protocol, security, retention, reconciliation, fenced leases, response fidelity, request binding, demo quotas, paid endpoints)", result: "47 passing on a local chain, including a real process crash and restart, concurrent redemption, chain reconciliation of an unredeemed payment, a handler slower than its lease, binary responses, a simulated reorg and storage failures", file: "evidence/M8_tests.txt" },
  { name: "Agent client SDK (@turnspike-qie/client) against the real middleware and contract", result: "16 passing: trusted payment, replay without second payment, price ceiling, untrusted merchant and origin, wrong network, low balance, paused, revoked, unlisted merchant, no gas, dry run, decline, expiry, gateway down after payment, crash between broadcast and journal write, unconfirmed transaction, delayed gateway, state change before broadcast", file: "evidence/M8_tests.txt" },
  { name: "CLI (turnspike) on a local chain", result: "10 passing: usage and exit codes, init without secrets, account inspect, probe, refusal without confirmation, dry run, pay and verify, policy refusals, wrong password, doctor", file: "evidence/M8_tests.txt" },
  { name: "Two-sided example on built packages (seller middleware and agent client)", result: "END-TO-END OK: paid, replayed without second charge, invalid input refused with 400, price ceiling held", file: "evidence/M8_tests.txt" },
  { name: "Middleware against the deployed mainnet contract", result: "Paid call delivered; same proof replayed from the store; on-chain replay refused", file: "evidence/M3_mainnet_integration.json" },
  { name: "Static analysis (Slither 0.11.6) and dependency audit", result: "No High or Medium findings in project code; 0 runtime-dependency vulnerabilities (52 advisories in dev tooling). Not an audit.", file: "evidence/M6_static_analysis.txt" },
  { name: "Block observation on QIE (94 consecutive blocks, two RPCs)", result: "No block hash changed and both RPCs agreed. This does not prove finality.", file: "evidence/M6_finality_observation.md" },
  { name: "Wallet app in a browser against the real contract on a local chain-1990 node (mock wallet)", result: "Approve, deposit, policy, merchant, pause, withdraw, revoke, wallet rejection, no-gas, wrong network, account change, disconnect, history: all behaved as specified. Not tested with QIE Wallet or MetaMask", file: "evidence/M7_browser_e2e.md" },
  { name: "Lighthouse on the Vercel production site (mobile profile)", result: "Home: performance 92, accessibility 100, best practices 100, SEO 100. Playground: 90, 100, 100, 100", file: "evidence/M7_lighthouse.md" },
  { name: "Read-only mainnet simulations of two refusals", result: "MerchantNotAllowed and NotOwnerAgent returned by the deployed contract (eth_call)", file: "evidence/M7_mainnet_simulations.md" },
  { name: "Restart persistence on the hosted gateway", result: "Delivered count unchanged after a machine restart", file: "evidence/M5_restart_persistence.txt" },
];

export const NOT_YET: string[] = [
  "Independent bytecode comparison for the deployed contract (the explorer reports the source as verified).",
  "Why reverted calls are charged gas: receipts show exactly 50% of the gas limit in all 5 samples (a hypothesis, not a confirmed rule; see M6_gas_and_qusdc.md).",
  "Chain finality: no reorg was observed over 94 blocks, which does not establish finality.",
  "Who holds QUSDC mint and burn roles.",
  "The web app has been driven with a mock wallet against a local chain, not with QIE Wallet, MetaMask or a mobile wallet, and no transaction has been sent from the UI to mainnet.",
  "The public demo is protected by quotas, proof of work and a gas floor, but the demo agent holds a small funded key on the gateway; if it runs out of gas the demo pauses until topped up.",
  "No external user or merchant has used Turnspike yet. Every mainnet transaction above is from project-operated wallets; the usage counters below show whatever the gateway records.",
  "The npm packages (@turnspike-qie/middleware, client, cli 0.1.0) were installed and run from a clean folder by the project, not yet by an independent developer.",
];
