# Turnspike video storyboards

The trailer is a **rendered evidence animatic**; the demo (revision 2) is built from real Chrome captures and terminal recordings plus labelled historical evidence. Originally both pieces were rendered evidence animatics: every screen is a real screenshot of the live product or explorer taken on 2026-11-19, every terminal panel shows command output captured verbatim on 2026-11-19, and every transaction is one that already exists on QIE Mainnet. Nothing on screen is a new payment, and nothing is presented as a live screen recording. A small tag in the corner of every demo frame says "Rendered from real captures, 19 Nov 2026".

Format: 1920x1080, 30 fps, h264 crf 18. Captions are burned in (the narration text), so both work muted.

## TurnspikeHackathonDemo (120 s), revision 2 with real Chrome and terminal captures
Every scene carries a source tag in the top-right corner: "Chrome capture" (still frames taken in Chrome, not a continuous screen recording), "Terminal recording" (asciicast, replayed at recorded speed), "Historical evidence" (the 19 Nov 2026 09:14 UTC mainnet run) or "Animation".

| Beat | Time | Source | Visual | Caption |
|---|---|---|---|---|
| 1 Hook | 0:00-0:07 | Animation | Asphalt field, logo, headline | "An AI agent that can pay for APIs needs a budget it cannot break." |
| 2 Gate | 0:07-0:19 | Chrome capture | Home page 402 ticket at 4:26 then 4:13, then after "Ask the gate again" with a new request id (`0xdf47532d…` to `0xbe7058f3…`) | "On the live site, an unpaid request gets HTTP 402: a price, a countdown, and a new request id each time you ask." |
| 3 Quote | 0:19-0:32 | Chrome capture and terminal recording | Playground "Request without paying" 402 JSON; `curl -si` replayed | "The quote is signed by the seller, expires, and is bound to this one request…" |
| 4 Owner limits | 0:32-0:45 | Chrome capture and terminal recording | Playground "Demo account limits"; `turnspike account inspect` replayed | "The owner's limits live in the settlement contract…: 0.01 QUSDC per call, 0.03 per day." |
| 5 Agent checks | 0:45-0:58 | Terminal recording | `agent.ts` excerpt; `turnspike api probe` replayed (exit 3, refused) | "The agent's SDK pays only merchants on its own list…" |
| 6 Payment | 0:58-1:16 | Historical evidence, explorer opened in Chrome | Lane from `evidence/M8`; then the explorer page for `0x7e41ccaa…21b7` captured in Chrome | "A real purchase the project made on QIE Mainnet on 19 November…" |
| 7 Receipt | 1:16-1:25 | Terminal recording | `turnspike api verify` replayed | "Anyone can verify it…" |
| 8 Replay | 1:25-1:34 | Historical evidence | M8 second-run log | "Run it again with the same key… No second charge." |
| 9 Refusals | 1:34-1:48 | Historical evidence, explorer opened in Chrome | CapExceeded, RequestAlreadyUsed and revokeAgent pages captured in Chrome | "Over the cap or a reused request: the contract refuses…" |
| 10 Close | 1:48-2:00 | Animation | Limitations (including the coverage-instrumented deployment), end card | "Unaudited, not x402-compatible…" |

## TurnspikeLaunchTrailer (28 s)
| Beat | Time | Visual | Text |
|---|---|---|---|
| 1 | 0:00-0:03.5 | Live home screenshot hero settles in | "Your agent can pay for APIs." |
| 2 | 0:03.5-0:08 | Barrier arm drops onto the live 402 ticket (the design's one orchestrated motion) | "Now it can't overspend." |
| 3 | 0:08-0:13 | Tariff board rows from the real on-chain read | "Per-call cap 0.01 QUSDC. Daily cap 0.03 QUSDC. Set by the owner, enforced by the contract." |
| 4 | 0:13-0:19 | Lane lights up: 402, paid, delivered; real tx hash; barrier lifts | "Paid on QIE Mainnet. 0.001 QUSDC. Real transaction, 19 Nov 2026." |
| 5 | 0:19-0:23 | Stop stripe, CapExceeded | "Over the cap? Refused. No QUSDC moved." |
| 6 | 0:23-0:28 | End card with the site's real tagline | "Agents pay at the gate. Owners set the toll." turnspike-qie.vercel.app, npm i @turnspike-qie/client |
