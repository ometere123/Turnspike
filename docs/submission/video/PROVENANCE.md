> **History.** This describes the videos of 19 November 2026, which are not submitted. The submission video (24 November 2026) is described in [README.md](README.md).

# Asset provenance

## Revision 2 sources (demo)
### Chrome captures (`public/chrome/`)
Taken on 2026-11-19 between 21:24 and 21:29 UTC through Claude in Chrome, in the owner's "converts" Chrome profile. The tab's viewport was 893x624 (resizing the window did not enlarge it on that display). The tool captures still frames per browser action and exports GIFs of those frames; it cannot record continuous video, so these are still frames, not a screen recording. Only free, read-only actions were taken: page loads, scrolling, "Ask the gate again" (an unpaid GET) and the playground's "Request without paying" (an unpaid GET). No scenario run, no wallet connection, no signature, no payment.

| File | Page |
|---|---|
| 01-home-hero.jpg | turnspike-qie.vercel.app |
| 02/03-home-402-ticket-*.jpg | home page live 402 ticket at 4:26 and 4:13 remaining |
| gif/f01-f07.png, ts-home-402.gif | frames of the home-page sequence; f05 shows the new request id after "Ask the gate again" |
| 04-07-playground-*.jpg | /playground: top, Demo account limits, the 402 returned by "Request without paying" |
| 08-app-not-connected.jpg | /app without a connected wallet (not used: wallet not connected) |
| 09/10-explorer-pay-success-*.jpg | the 0x7e41ccaa…21b7 transaction page |
| 11-explorer-contract-verified.jpg | the contract page, "Contract Source Code Verified" |
| 12-explorer-contract-source-instrumented.jpg | the verified source, which contains coverage instrumentation (not used in the video; see the disclosure in the repository) |
| 13/14/15-explorer-*.jpg | CapExceeded, RequestAlreadyUsed and revokeAgent transaction pages |

### Terminal recordings (`public/casts/`, asciicast v2)
Recorded 2026-11-19 at 21:30 UTC by `scripts/rec.mjs`, which stores each output chunk with the second it arrived. The published `@turnspike-qie/cli@0.1.1` (installed from npm into an empty folder) and `curl`; all read-only. The command line is shown as typed; output appears at its recorded time.

| File | Command | Exit |
|---|---|---|
| network.cast | `turnspike network status` | 0 |
| probe.cast | `turnspike api probe https://turnspike-qie.fly.dev/v1/block-summary` (empty test configuration) | 3 (refused) |
| account.cast | `turnspike account inspect 0x7791…3E4C` | 0 |
| verify.cast | `turnspike api verify 0x7e41ccaa…21b7` | 0 |
| curl402.cast | `curl -si https://turnspike-qie.fly.dev/v1/block-summary` | 0 |

## Revision 1 sources (trailer, and the earlier demo)

Every visual in both videos comes from one of the sources below. No screen, number, hash or label was invented. Nothing was paid to make these assets: every capture is a read-only request or a screenshot.

## Screenshots (public/screens/, 1920x1080)
Taken on 2026-11-19 between about 20:39 and 20:42 UTC with Remotion's bundled headless Chrome (`chrome-headless-shell --window-size=1920,1080 --virtual-time-budget=12000 --screenshot`), no login, no wallet extension.
| File | URL | Used in |
|---|---|---|
| home.png | https://turnspike-qie.vercel.app/ (the live 402 card was fetched by the page from the gateway) | demo 2, trailer 1 |
| playground.png | https://turnspike-qie.vercel.app/playground ("Demo account limits" is the page's own contract read) | demo 4 |
| explorer_tx.png | https://mainnet.qie.digital/tx/0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7 | demo 6 |
| explorer_capexceeded.png | https://mainnet.qie.digital/tx/0x7b4414737c6ccfb74db7237dba65e8c7741dad6d34b1db167a2c33c1d0c7cff1 | demo 9 |
| product.png, app.png, developers.png, evidence.png, security.png, explorer_contract.png | the corresponding live pages | captured, not used in the current cut |
`app.png` shows the owner console without a wallet ("Connect your wallet to open the console"), which is why the owner limits in the video come from the playground's contract read and the CLI instead of the console.

## Command output (public/captures/, verbatim)
Captured 2026-11-19 at about 20:38 UTC (`captured_at.txt`), with `curl` and the **published** `@turnspike-qie/cli@0.1.1` installed from the npm registry into an empty folder. All read-only.
| File | Command |
|---|---|
| http_402.txt | `curl -i https://turnspike-qie.fly.dev/v1/block-summary` |
| cli_account.txt | `turnspike account inspect 0x77918289D518303DDE4f84098B507bdB1dc73E4C` |
| cli_network_status.txt | `turnspike network status` |
| cli_probe.txt | `turnspike api probe https://turnspike-qie.fly.dev/v1/block-summary` (empty test configuration, so the payee is untrusted) |
| cli_verify.txt | `turnspike api verify 0x7e41ccaa…21b7` |
`scripts/build-data.mjs` copies these files into `src/data.generated.ts` unchanged. Demo scene 3 shows the 402 status line, the date header and the JSON body fields one per line; the `sig` is shortened on screen.

## From the Turnspike repository
| Source | Used in |
|---|---|
| `evidence/M8_sdk_mainnet.md` first and second run logs (project-operated, 2026-11-19 09:14 UTC) | demo 6 (lane), demo 8 (replay, verbatim) |
| `evidence/M7_live_demo.json` (CapExceeded `0x7b44…cff1`, RequestAlreadyUsed `0x4092…79cb`) | demo 9, trailer 5 |
| `evidence/M4_mainnet_demo.json` (revoke `0xe860…2201`, then NotOwnerAgent refused before broadcast) | demo 9 |
| `examples/node-agent/src/agent.ts` lines 21 to 31 | demo 5 |
| `apps/web/src/app/icon.svg` (logo) | both |
| `apps/web/DESIGN.md` tokens, the home page tagline "Agents pay at the gate. Owners set the toll." | both |
Note: the M7 refusals were made through the gateway's old hostname `turnpike-qie.fly.dev` (before the rename); the contract is the same.

## Numbers on screen
0.001 QUSDC (live 402 `priceBase` 1000, 6 decimals); 92,159 gas and 0.000103678875 QIE (`cli_verify.txt`, explorer); 15 s (`evidence/M8_sdk_mainnet.md`); block 12015683 (same); per-call 0.01 and daily 0.03 QUSDC, spent today 0.008 (`cli_account.txt`, playground); 5 deliveries, 0 external (`GET /v1/stats`, playground); 5 QUSDC deposit cap (constructor argument in `evidence/deployment.json`).

## Fonts and code
Archivo (variable, width and weight axes) and IBM Plex Mono from github.com/google/fonts, Open Font License (licence texts in `public/fonts/`). Scaffold and workflow: github.com/EveryInc/product-launch-video (MIT, commit 68660ae), Remotion 4.
