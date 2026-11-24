# Demo video: plan for the release candidate

**A demo video is mandatory** (official FAQ, read 2026-11-24). No length limit was found; the target is 2 to 3 minutes. Nothing here pays, signs with a real wallet, or runs a playground scenario.

## What exists
| Piece | What it is | Where |
|---|---|---|
| Release-candidate recording | Genuine headless-Chromium screen video of the pages below, with captions and a source tag burned in. No narration | Made by the commands below; not committed (large). Commit and hash are in `docs/RELEASE_QA.md` |
| Revision 2 demo (120 s) and trailer (28 s) | Older renders: Chrome still frames and terminal replays. They predate Operations | `video/README.md` (Windows paths, outside the repository) |

## Storyboard
Every scene shows one of these tags: PUBLIC SITE or RELEASE CANDIDATE BUILD, with LIVE QIE MAINNET READS, READ ONLY · HISTORICAL PAYMENT, 19 NOV 2026, PROJECT OPERATED · LOCAL CHAIN, TEST TOKEN, MOCK WALLET: NOT MAINNET · RECORDED OUTPUT.

| Scene | Screen | Say |
|---|---|---|
| 1 Gate | Live home page, unpaid 402 ticket (no signature shown) | An AI agent that can pay for APIs needs a budget it cannot break. Turnspike puts a toll gate in front of an API. This unpaid request just got a real HTTP 402. |
| 2 Operations | Live `/operations`, recorded example, Inspect, Check delivery | Check a payment without a wallet. This is a purchase the project itself made on 19 November 2026; nothing is being paid now. The receipt comes from QIE; delivery is the gateway's own claim. |
| 3 Refusals | Live `/evidence` | Over the cap, a reused request: real reverted transactions, project operated. No external users yet. |
| 4 Limits | Live `/security` | Unaudited. The deployed bytecode is a coverage-instrumented build. Late or undelivered payments are not refunded automatically. |
| 5 Owner | Console on a local chain with a test token | Every write has a review: network, account, contract, amount. One agent key, a per-call cap, a daily cap. Pause, revoke or withdraw at any time. |
| 6 Agent and seller | Recorded output of `examples/end-to-end/run.mjs` | 402, pay, 200, then a replay with one charge, and two refusals. The SDK and CLI are on npm. |

### 60-second cut
Scenes 1 (12 s), 2 (25 s), 5 (12 s), 4 (11 s), in that order. It is the same path as `JUDGE.md`.

## Make the recording
```sh
node examples/end-to-end/run.mjs > terminal.txt
RECORD_TERMINAL=$PWD/terminal.txt node apps/web-e2e/run.mjs record
LIVE_URL=https://turnspike-qie.vercel.app node apps/web-e2e/record.mjs live     # after the release
# before it: serve the build on localhost:3000 (the gateway allows that origin) and set RECORD_SOURCE="RELEASE CANDIDATE BUILD"
cd apps/web-e2e/results/video
ffmpeg -i live.webm -i local.webm -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -r 30 -c:v libx264 -crf 20 -pix_fmt yuv420p demo.mp4
```

## If you record it yourself (recommended: it is your presentation)
1. OBS Studio: Display or Window Capture at 1920x1080, 30 fps, MP4; or Windows Game Bar (Win+Alt+R). Browser zoom 110 percent, notifications off.
2. Use a clean browser profile: no wallet extension, no bookmarks, no balances. Do not open the playground's 402 JSON on camera; it prints the secret half of a proof (`sig`).
3. Follow the storyboard. Say the tag of each scene out loud. Read the captions or use your own words; every number is in `evidence/` or `docs/RELEASE_QA.md`.
4. A connected-wallet scene on mainnet is optional, read-only, and yours alone to grant. Never press a button that opens a review.
5. If the gateway or RPC is down while recording, say so on camera. Sources for a labelled fallback: `evidence/M8_sdk_mainnet.md`, `M7_live_demo.json`, `M4_mainnet_demo.json`.
6. Watch it once in full against this table, then upload it yourself and paste the link into the form.
