# @turnspike-qie/mcp

Lets an MCP app (Claude, Cursor and others) read Turnspike vaults and pay Turnspike APIs in QUSDC on QIE. It runs on the user's own computer with the user's own agent key. New and unaudited.

## Which package do I need?
| You are | Use |
|---|---|
| Writing an agent in code that pays on its own, inside its owner's limits | `@turnspike-qie/client` |
| Working in a terminal or a script | `@turnspike-qie/cli` |
| Using an AI app, no code | this package |
| Selling an API | `@turnspike-qie/middleware` |

## Tools
| Tool | What it does | Can spend |
|---|---|---|
| `turnspike_account` | Balance, limits and spending today of a vault | No |
| `turnspike_probe` | Price of a listed API, checked against your configuration | No |
| `turnspike_verify` | Says whether a transaction is a Turnspike payment | No |
| `turnspike_pay` | Gets a listed API, after you confirm | Yes |
| `turnspike_resume` | Collects a purchase; asks before sending anything | Yes |

The last two exist only when payments are switched on.

## Set up
1. In the console (https://turnspike-qie.vercel.app/app): fund the vault, set the agent and its limits, allow the merchant. Sent from the owner's wallet; this program never sees that key.
2. Write `~/.turnspike/config.json` (the CLI's file: `npx @turnspike-qie/cli init --config ~/.turnspike/config.json ...`):
```json
{
  "owner": "0xOwner",
  "agentKeystore": "/full/path/agent.json",
  "maxPrice": "0.01",
  "payees": [{ "origin": "https://turnspike-qie.fly.dev", "merchant": "0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761" }]
}
```
3. Add it to your app:
```json
{ "mcpServers": { "turnspike": { "command": "npx", "args": ["-y", "@turnspike-qie/mcp"] } } }
```
Only reading? A hosted version needs no install and cannot pay: `https://turnspike-mcp.delealufejoel.workers.dev/mcp`.

Reading works now. To allow payments, add `"env": { "TURNSPIKE_MCP_PAYMENTS": "on", "TURNSPIKE_KEYSTORE_PASSWORD": "..." }`. That password sits in your app's settings file, so use an agent key that holds only a little gas.

Then ask in plain words: "What does the block summary cost? Get it."

## What protects you
- Every payment shows the price, merchant and API, and waits for your yes. An app that cannot show the question cannot pay. A yes is good once, for five minutes, for that purchase, and never for a higher price.
- The vault's own limits on QIE apply whatever this program does.
- Only listed origins are contacted, checked before any request. No redirects, no other hosts.
- No tool changes limits, payees or keys, or shows a key.
- One `purchase_key` is one purchase: a retry collects it and does not pay again.
- API answers are cut at 64 KB and marked as data. A model may still be misled by one; the limits and your yes are what hold.

## What does not
- Your MCP app is trusted: it draws the question and reports your answer. Do not set it to answer by itself.
- A payment is not refunded if the API then fails. Use `turnspike_resume`.
- A model that uses a new key for the same thing is making a second purchase. You are asked again.
- Payments use the first RPC in the configuration; reads try all of them. Only GET requests.

Tests: `npx vitest run packages/mcp` from the repository root after `npm run build` here. They drive the built program over stdio on a local chain. No real payment has been made through it.
