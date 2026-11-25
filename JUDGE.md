# Turnspike in 60 seconds

An AI agent that can pay for APIs needs a budget it cannot break. The owner posts limits in a contract on QIE Mainnet; an API answers unpaid requests with a signed HTTP 402; the agent pays in QUSDC inside those limits; the API verifies the receipt, stores the response and delivers it.

**Unaudited. Small amounts only. Not x402-compatible. No external users: every mainnet payment so far was made by the project's own wallets.**

| Seconds | Do this | What it shows |
|---|---|---|
| 0 to 15 | Open https://turnspike-qie.vercel.app | A live, unpaid 402 quote from the public gateway: price, countdown, request ID |
| 15 to 40 | Open [/operations](https://turnspike-qie.vercel.app/operations), choose **Load recorded example**, then **Inspect payment**, then **Check delivery state** | Your browser reads a real payment of **19 November 2026 (project-operated)** from QIE and compares it with the gateway's record. Settlement is on chain; delivery is the gateway's own claim. |
| 40 to 60 | Open [/evidence](https://turnspike-qie.vercel.app/evidence) | Refused payments (`CapExceeded`, `RequestAlreadyUsed`), the revoke, the tests, and a list of what is **not** verified |

## Check it without trusting us
- Contract, source verified: https://mainnet.qie.digital/address/0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c#code (chain 1990). The deployed bytecode is a coverage-instrumented build, 9,610 bytes, not the clean 3,570-byte one; [M9](evidence/M9_deployed_bytecode_verification.md) reproduces it exactly. That is reproducibility evidence, not an audit.
- Payment: [`0x7e41ccaa…21b7`](https://mainnet.qie.digital/tx/0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7). Over-cap refusal: [`0x7b441473…cff1`](https://mainnet.qie.digital/tx/0x7b4414737c6ccfb74db7237dba65e8c7741dad6d34b1db167a2c33c1d0c7cff1). Replay refusal: [`0x4092c6a8…79cb`](https://mainnet.qie.digital/tx/0x4092c6a833b48c65a263d27bd06f9753e1efab856ece5cee24ea300fa6de79cb).
- A free 402: `curl -i https://turnspike-qie.fly.dev/v1/block-summary`
- The CLI, read-only: `npx @turnspike-qie/cli@0.1.1 network status`
- The MCP server, read-only, for any MCP app: https://turnspike-mcp.delealufejoel.workers.dev/mcp

## Run it yourself (local chain, test token, no money)
```sh
npm ci --legacy-peer-deps && npx hardhat compile && npx hardhat test
(cd packages/middleware && npm install && npm run build) && (cd packages/client && npm install && npm run build)
node examples/end-to-end/run.mjs     # 402, pay, 200, replay without a second charge, refusals
```
On Windows without Visual Studio, add `--ignore-scripts` to the installs.

## Where things are
| | |
|---|---|
| The rules that hold the money | `contracts/TurnpikeAllowance.sol` |
| 402, verification, durable delivery | `packages/middleware` |
| The agent's side: payee list, price ceiling, crash-safe journal | `packages/client`, `packages/cli` |
| MCP server for AI apps (a person confirms each payment); hosted read-only version | `packages/mcp`, `apps/mcp-cf` |
| Site, owner console, operations | `apps/web` |
| What was tested, and what was not | [`docs/RELEASE_QA.md`](docs/RELEASE_QA.md) |
| Limits and trust | [`/security`](https://turnspike-qie.vercel.app/security), `docs/08_SECURITY_PRIVACY_AND_TRUST.md` |
| AI assistance and human contribution | [`docs/HUMAN_REVIEW_LOG.md`](docs/HUMAN_REVIEW_LOG.md) |

## Limits to know before judging
Payment that lands after its deadline, or whose delivery never succeeds, is not refunded automatically. The gateway is one service with one SQLite file. Daily caps use UTC days, so up to twice the cap can pass across midnight. Deposits are capped at 5 QUSDC. Finality is observed, not proven. The owner has run the full console cycle on mainnet with a browser wallet ([M11](evidence/M11_owner_cycle_2026-11-24.md)); mobile wallets have not been tried.
