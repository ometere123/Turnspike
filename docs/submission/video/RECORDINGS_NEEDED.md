# Remaining recording gaps (after revision 2)

Captured in revision 2: the live home page 402, the playground 402 and limits, the explorer pages for the payment, the contract and the refusals (Chrome still frames), and the CLI and curl runs (terminal recordings). Still missing:
1. **Continuous screen video.** The Chrome tool captures still frames per action, not video. A real screen recording (for example the Windows Game Bar, Win+Alt+R, or OBS) of the same read-only steps would replace the still frames.
2. **Owner console with the owner wallet connected** (`/app`). The converts profile's wallet was not connected, and connecting it is a wallet permission the owner must grant personally.
3. **Larger viewport.** The Chrome tab was 893x624; a 1920x1080 window would read better.
4. **A live paid run.** Deliberately not recorded: no new mainnet payment (owner decision D6). The video uses the 19 Nov 2026 purchase, labelled as historical.

# Original list (revision 1): recordings that would turn the animatic into a live demonstration

The rendered videos are honest animatics: real screenshots, real output and real past transactions, assembled. They are not screen recordings. If the owner wants a live demonstration, these are the takes to record. **None of them requires a new payment**: each one either reads data or replays an existing purchase.

| # | Replaces demo scene | What to record (1920x1080, browser zoom 110 percent, terminal font 18 pt) | Cost |
|---|---|---|---|
| 1 | 2 The gate | Open https://turnspike-qie.vercel.app in a clean window; the live 402 card fills in; click "Ask the gate again". | none |
| 2 | 3 The quote | In a terminal: `curl -i https://turnspike-qie.fly.dev/v1/block-summary`. | none |
| 3 | 4 Owner limits | The owner console at /app with the owner wallet connected, showing deposit, per-call cap, daily cap and allowlist (do not submit any change). This needs the owner's wallet extension, which the capture browser did not have. | none (read only) |
| 4 | 5 Agent checks | `npx @turnspike-qie/cli@0.1.1 api probe https://turnspike-qie.fly.dev/v1/block-summary` with a configuration that trusts the gateway, so the verdict says the payee is trusted. | none |
| 5 | 6 and 7 Payment and receipt | Open the explorer page for `0x7e41ccaa…21b7`, then run `npx @turnspike-qie/cli@0.1.1 api verify 0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7`. Say on camera that this purchase was made on 19 November. | none |
| 6 | 8 Replay | Rerun `node examples/node-agent/dist/agent.js` with `PURCHASE_KEY=evidence-node-agent-1` and the same journal file used on 19 November (if it still exists on the machine that ran it): it replays without paying. If the journal is gone, do not rerun with a new key, because that would make a new payment. | none if the journal exists |
| 7 | 9 Refusals | Open the explorer pages for the CapExceeded and RequestAlreadyUsed transactions. | none |

Never show private keys, keystore paths that include a username, passwords or the `.meter402` password file. A **new** paid run is a separate owner decision (D6 in `docs/OWNER_DECISIONS.md`) and is not part of this plan.
