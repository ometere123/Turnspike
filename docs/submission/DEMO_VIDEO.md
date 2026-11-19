# Demo video: script, shot list and fallback

**Not recorded.** Target length 2:00 (no official limit was found; keep it short). Every number on screen must come from a real run. Say "unaudited, small amounts" once.

## Before recording
- Wallets: owner with a few cents of QUSDC deposited, agent with a little QIE, merchant allowlisted (console, `/app`). Check `turnspike doctor` and `turnspike account inspect <owner>`.
- Use the real hosted gateway (https://turnspike-qie.fly.dev). Each paid call costs 0.001 QUSDC plus about 0.0001 QIE; the owner approves any spend (D6).
- Do a dry run first. If the gateway is down, say so on camera; do not fake it.

## Script (spoken text in quotes)
| Time | Screen | Say | Proves |
|---|---|---|---|
| 0:00 | Home page, hero | "Agents pay at the gate, owners set the toll. Turnspike lets an API charge per request in QUSDC on QIE, and lets the agent's owner keep hard limits." | what it is |
| 0:12 | Home live 402 card | "An unpaid request gets a real 402 from the live gateway: signed, expiring, bound to one resource." | live mainnet gateway |
| 0:25 | Console `/app`: owner sets per-call cap, daily cap, allowlist | "The owner posts the rules. They live in the settlement contract." | on-chain policy |
| 0:40 | Terminal: `turnspike api pay https://turnspike-qie.fly.dev/v1/block-summary` (confirm) | "The agent shows merchant, price and gas, then pays." | SDK/CLI flow |
| 0:58 | Explorer tab for the new tx | "The Paid event on QIE Mainnet. About 15 seconds end to end." | real settlement |
| 1:05 | Playground: run `over-cap` and `unauthorized-merchant` | "Over the cap or to a merchant the owner has not allowed: the transaction reverts with a named error and no QUSDC moves." | enforcement |
| 1:25 | Re-run `turnspike api pay` with same key | "Same key again: the stored response is replayed, the owner is charged once." | replay and recovery |
| 1:40 | Evidence page | "Real numbers only. No external users yet. Unaudited. Here is what we do not claim." | honesty |
| 1:52 | `npm i @turnspike-qie/middleware` | "One middleware for sellers, an SDK and a CLI for agents." | adoption path |

## Shot-by-shot recording guide
1. 1920x1080, browser zoom 110 percent, terminal font 18 pt, hide notifications and any wallet balances you do not want public (never show keys, keystore paths with usernames, or passwords).
2. One continuous take per row; trim in editing, not by pausing the story.
3. Leave the explorer URL on screen for 3 seconds.
4. Voice-over after capture is fine; subtitles on.
5. End card: repository URL and the contract address.

## Fallback demo plan (if live endpoints or funds fail)
Clearly label every fallback clip "recording of a real mainnet run" with its date. Sources, all in `evidence/`:
- `M8_sdk_mainnet.md`: SDK purchase and same-key replay (tx `0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7`, block 12015683, 15 s).
- `M4_mainnet_demo.json`, `M7_live_demo.json`, `M7_live_demo_unlisted.json`: allowed, over-cap, replay and unauthorized-merchant scenarios.
- `M7_browser_e2e.md`, `M7_mainnet_simulations.md`: browser and outage simulations.
- `M5_live_demo_run.txt`, `M5_restart_persistence.txt`: restart persistence.
Open each transaction on https://mainnet.qie.digital while narrating. The local `examples/end-to-end` run may be shown only if labelled "local chain, test token".
