# Narration (final script)

The captions burned into `TurnspikeHackathonDemo` are this script, so the video works muted. If the owner records a voice-over, read it at a calm pace (about 2 minutes, roughly 150 words per minute) and keep the wording; every number in it is checked against `evidence/`.

| Time | Line |
|---|---|
| 0:00 | An AI agent that can pay for APIs needs a budget it cannot break. |
| 0:07 | Turnspike puts a toll gate in front of an API. An unpaid request gets HTTP 402. |
| 0:17 | The quote is signed by the seller, expires, and is bound to this one request: price, merchant, chain, contract and request id. |
| 0:31 | The owner posts limits in the settlement contract on QIE Mainnet: 0.01 QUSDC per call, 0.03 per day. The agent cannot change them. |
| 0:45 | The agent's SDK pays only merchants on its own list, under its own price ceiling. The CLI shows the verdict before any money moves. |
| 0:59 | A real purchase the project made on QIE Mainnet on 19 November: 0.001 QUSDC, 92,159 gas, about 15 seconds from quote to response. |
| 1:17 | Anyone can verify it. The CLI decodes the Paid event straight from the chain. |
| 1:27 | Run it again with the same key and the stored response comes back. No second charge. |
| 1:37 | Over the cap, a reused request, a revoked agent: the contract refuses, and no QUSDC moves. |
| 1:49 | Unaudited, not x402-compatible, and every payment so far was made by the project itself. Try it at turnspike-qie.vercel.app. |

The trailer has no narration; its on-screen text is in `STORYBOARD.md`.

## Suggested upload text (owner edits)
Title: Turnspike: owner-controlled API payments for AI agents on QIE Mainnet (QIE Hackathon 3.0)
Description: Evidence-led demo. Screens are real screenshots of the live product and the QIE explorer, terminal panels are real command output, and the mainnet payment shown is a project-operated purchase from 19 November 2026 (tx 0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7). Rendered from those captures; not a live screen recording. Unaudited; small amounts only. Repository: https://github.com/ometere123/Turnspike
