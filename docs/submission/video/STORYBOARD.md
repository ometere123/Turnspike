# Turnspike video storyboards

Both pieces are **rendered evidence animatics**: every screen is a real screenshot of the live product or explorer taken on 2026-11-19, every terminal panel shows command output captured verbatim on 2026-11-19, and every transaction is one that already exists on QIE Mainnet. Nothing on screen is a new payment, and nothing is presented as a live screen recording. A small tag in the corner of every demo frame says "Rendered from real captures, 19 Nov 2026".

Format: 1920x1080, 30 fps, h264 crf 18. Captions are burned in (the narration text), so both work muted.

## TurnspikeHackathonDemo (120 s)
| Beat | Time | Visual (source) | Caption / narration |
|---|---|---|---|
| 1 Hook | 0:00-0:07 | Asphalt field, Turnspike mark, headline types in. Honesty tag appears. | "An AI agent that can pay for APIs needs a budget it cannot break." |
| 2 The gate | 0:07-0:17 | `screens/home.png`, slow push into the live 402 ticket | "Turnspike puts a toll gate in front of an API. An unpaid request gets HTTP 402." |
| 3 The quote | 0:17-0:31 | Terminal: `captures/http_402.txt` (status line and JSON fields), fields highlighted in turn | "The quote is signed by the seller, expires, and is bound to this one request: price, merchant, chain, contract, request id." |
| 4 Owner limits | 0:31-0:45 | `screens/playground.png` crop of "Demo account limits", then terminal `captures/cli_account.txt` | "The owner posts limits in the settlement contract on QIE Mainnet: 0.01 QUSDC per call, 0.03 per day. The agent cannot change them." |
| 5 Agent checks | 0:45-0:59 | Code from `examples/node-agent/src/agent.ts` (policy and approve lines), then terminal `captures/cli_probe.txt` | "The agent's SDK only pays merchants on its own list, under its own price ceiling. Here the CLI shows the verdict before any money moves." |
| 6 The payment | 0:59-1:17 | Lane of events from `evidence/M8_sdk_mainnet.md`: broadcast, confirmed in block 12015683, delivered 200. Badge: "Historical mainnet run, 19 Nov 2026, project-operated wallets". Then `screens/explorer_tx.png` | "This is a real purchase the project made on QIE Mainnet on 19 November: 0.001 QUSDC, 92,159 gas, about 15 seconds from quote to response." |
| 7 Receipt | 1:17-1:27 | Terminal `captures/cli_verify.txt` | "Anyone can verify it. The CLI decodes the Paid event straight from the chain." |
| 8 Replay | 1:27-1:37 | Lane from the M8 second run: resume, state delivered, stored response replayed, no new transaction | "Run it again with the same key and the stored response comes back. No second charge." |
| 9 Refusals | 1:37-1:49 | `screens/explorer_capexceeded.png` with stop stripe; list of real refusal hashes (CapExceeded, RequestAlreadyUsed, NotOwnerAgent after revoke) | "Over the cap, a reused request, a revoked agent: the contract refuses, and no QUSDC moves." |
| 10 Limits and close | 1:49-2:00 | Plain list, then end card: site URL, npm packages, contract address | "Turnspike is unaudited and not x402-compatible, and every payment so far was made by the project itself. Try it at turnspike-qie.vercel.app." |

## TurnspikeLaunchTrailer (28 s)
| Beat | Time | Visual | Text |
|---|---|---|---|
| 1 | 0:00-0:03.5 | Live home screenshot hero settles in | "Your agent can pay for APIs." |
| 2 | 0:03.5-0:08 | Barrier arm drops onto the live 402 ticket (the design's one orchestrated motion) | "Now it can't overspend." |
| 3 | 0:08-0:13 | Tariff board rows from the real on-chain read | "Per-call cap 0.01 QUSDC. Daily cap 0.03 QUSDC. Set by the owner, enforced by the contract." |
| 4 | 0:13-0:19 | Lane lights up: 402, paid, delivered; real tx hash; barrier lifts | "Paid on QIE Mainnet. 0.001 QUSDC. Real transaction, 19 Nov 2026." |
| 5 | 0:19-0:23 | Stop stripe, CapExceeded | "Over the cap? Refused. No QUSDC moved." |
| 6 | 0:23-0:28 | End card with the site's real tagline | "Agents pay at the gate. Owners set the toll." turnspike-qie.vercel.app, npm i @turnspike-qie/client |
