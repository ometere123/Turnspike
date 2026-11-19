# @turnspike/cli

`turnspike` inspects QIE allowance accounts, probes and pays Turnspike APIs, and verifies payments. It is built on `@turnspike/client`, so it applies the same trust policy and recovery as the SDK. Not published to npm yet:

```bash
cd packages/client && npm install && npm run build && cd ../cli && npm install && npm run build
node dist/bin.js --help          # or: npm link, then: turnspike --help
```

## Setup
```bash
turnspike init --owner 0xOwner --keystore ~/.foundry/keystores/my-agent \
  --payee https://turnspike-qie.fly.dev=0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761 --max-price 0.005
turnspike doctor
```
`init` writes `turnspike.config.json` with the network, owner, keystore **path**, payees and price ceiling. No secret is written. The keystore must hold the **agent** key (any encrypted JSON keystore: Foundry, geth, ethers). Its password is read from `TURNSPIKE_KEYSTORE_PASSWORD` or asked without echo; there is deliberately no password flag, because flags land in shell history.

## Commands
| Command | What it does |
|---|---|
| `doctor` | RPC, chain id, contract code, contract token, owner balance, pause state, agent and agent gas |
| `config show` | the resolved configuration |
| `network status` | head block, time, gas price and latency of each RPC |
| `account inspect <owner>` | allowance balance, wallet QUSDC, agent, per-call and daily caps, spent today |
| `merchant inspect <merchant> [--owner 0x] [--blocks N]` | allowlist status and recent `Paid` events to the merchant |
| `api probe <url>` | requests the URL and checks its 402 against your policy; never pays |
| `api pay <url> [--max-price] [--dry-run] [--yes] [--key]` | shows network, merchant, price and gas, asks, pays, prints the response and explorer link |
| `api resume <key>` | finishes a paid-but-undelivered purchase; never pays twice |
| `api verify <tx-hash>` | decodes a payment: status, confirmations, gas, owner, agent, merchant, amount |
| `demo run [scenario]` | solves the public demo's proof of work and runs it (`allowed`, `over-cap`, `replay`, `unauthorized-merchant`) |

`--json` gives machine-readable output on every command. Without a terminal, `api pay` never spends unless `--yes` is given.

## Exit codes
`0` ok, `1` error, `2` usage, `3` refused by policy or chain (nothing paid), `4` paid but not yet delivered (run `api resume`).

```bash
turnspike api pay https://turnspike-qie.fly.dev/v1/block-summary --json --yes | jq .payment.explorerUrl
```

Owner operations (deposit, limits, merchants, pause, revoke, withdraw) are not in the CLI: they need the owner's key and are done in the web console with a wallet.
