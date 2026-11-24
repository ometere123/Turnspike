# Full application acceptance report

24 November 2026. Hands-on use in Google Chrome (Claude in Chrome: real clicks and typing), backed by the Playwright suite. Three environments, never mixed:

| Name | What it is |
|---|---|
| **Staging** | Vercel preview of the branch with the Cloudflare staging gateway. Reads QIE Mainnet. Payments off |
| **Local** | Production build on a local chain (reports chain 1990), real contract, test token, real Express gateway, an injected test wallet |
| **Production** | https://turnspike-qie.vercel.app, still the older commit `01c7f3b`; read only |

**No mainnet transaction was made and no real wallet was connected or asked to sign.** A successful local transaction is not evidence of a mainnet one.

## Workflows
| # | Workflow | Where | Result |
|---|---|---|---|
| 1 | Home and navigation | Staging, Chrome | Pass. Closed gate said so; badge defect fixed (D1) |
| 2 | Product, Developers, Security, Evidence | Staging, Chrome | Pass |
| 3 | Owner console, not connected | Staging, Chrome | Pass |
| 4 | Wallet choice and network detection | Local, Chrome | Pass after D2. Chrome offered Rabby and Phantom; neither was selected. Wrong network warned, blocked and recovered |
| 4b | Connecting a real wallet on mainnet | Staging | **Blocked: needs the owner** (below) |
| 5 | Balances and allowance | Local, Chrome | Pass: 100, 98 and 98.5 in the wallet; 0, 2 and 1.5 in the vault, as expected |
| 6 | Agent policy | Local, Chrome | Pass; D3 fixed |
| 7 | Merchant allowlist and QIE ID | Local, Chrome; QIE ID API live | Pass: "No QIE ID name"; the address sent is the address shown |
| 8 | Pause, withdraw while paused, revoke | Local, Chrome | Pass |
| 9 | Transaction history | Local, Chrome | Pass: six events, read from the chain, newest first |
| 10 | Operations | Staging, Chrome | Pass |
| 11 | Historical mainnet payment | Staging, Chrome, QIE Mainnet | Pass: `0x7e41ccaa…21b7`, 0.001 QUSDC, block 12,015,683, project operated, 19 November 2026 |
| 12 | Gateway records | Staging, Chrome | Pass: this gateway has no record, so it says `PAID UNRECORDED`, keep the proof, do not pay again. Agreement with a `DELIVERED` record: Local (OP-01) and the Fly gateway from localhost:3000 (LIVE-02) |
| 13 | SDK and CLI | Local; CLI also mainnet read only | Pass: SDK bought from both gateways locally; `cli network status` read QIE Mainnet |
| 14 | Errors, retry, recovery | Staging and Local, Chrome | Pass: malformed hash, over-cap amount, rejected signature, wrong network. Lost confirmation, RPC outage and crash: Playwright and workerd tests |
| 15 | Mobile and desktop | Chrome desktop; mobile by Playwright at 390 and 768 px | Pass. Chrome's window would not resize in this session, so no hand test on a phone-sized window |
| 16 | Entry to verified outcome | Local | Pass: 402, pay, 200, replay, then verified and matched in Operations (OP-01, CF-02, CF-03) |
| 17 | Playground paid run | all | Not run: it spends real QUSDC. On the Cloudflare gateway the scripted agent does not exist, because the gateway holds no key |

## Defects found by using it, and fixed
| # | Defect | Retest |
|---|---|---|
| D1 | A closed gate still showed a "402" badge and dots for missing values | Build and WEB-07 |
| D2 | With several wallet extensions, the app used whichever one won `window.ethereum`. Now it lists them and remembers the choice | Chrome (chooser) and AP-18 |
| D3 | After a deposit or a revoke confirmed, the form stayed ready to send the same thing again | AP-03 |
| D4 | The header badge said "QIE Mainnet" while the wallet was on another network | AP-06 |
| D5 | The signing review focused a copy button, and the address ran into it | Wider dialog, neutral focus |
| D6 | The console had no way to Operations | Navigation link |
| D7 | Too much text on most pages | Shortened |

## Console and network
- One exception on page load, from a wallet extension, not from Turnspike: `Cannot redefine property: ethereum` (`evmAsk.js`). No Turnspike console error in either environment.
- Staging calls answered 200 except the intended 503 `payments_disabled`.

## Unresolved
| Item | Why |
|---|---|
| Production has no `/operations` and still uses Fly | Owner approval |
| Transactions pending across a reload are shown only once mined | P2, accepted; nothing offers to resend them |
| QIE Wallet, MetaMask, phones, screen readers | Not used. Needs a person |

## What the owner does to finish 4b (read only, reversible, no gas)
1. Open the staging preview (its link is on the pull request) in Chrome, then **Open the console**, then **Connect wallet**.
2. Choose Rabby or QIE Wallet. Select **QIE Mainnet, chain 1990**. Approve **connect only**: it shares an address, signs nothing, and can be undone with Disconnect.
3. Check that the balances are yours. Press nothing that opens a review. Tell the assistant it is connected; it will check the displays and stop again before any signature.
Never share a seed phrase, private key or wallet password.

## Automated results behind this report
Browser 64 of 64; Cloudflare gateway 30 of 30 in workerd; web unit, contract, middleware, SDK and CLI suites in CI on the pull request's head.
