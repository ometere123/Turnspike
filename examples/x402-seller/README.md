# Example: x402 v2 seller (`turnspike-allowance`)

A minimal Express API that sells `GET /v1/report` over x402 v2 with the custom scheme `turnspike-allowance`, and over `turnspike/1` on the same route. Settlement runs in-process (`LocalFacilitatorClient`); the seller holds no private key and never sends a transaction.

- `src/seller.ts`: `createSeller(config)` returns the Express app and the middleware. Read the comments for each option.
- `src/main.ts`: starts it from environment variables.

This example uses the workspace sources (it is not published). It is meant for a **local Hardhat chain only**.

## Run against a local chain

The quickest path is the two-sided demo, which deploys the contracts and starts this seller for you:

```bash
node examples/x402-agent/run-local.mjs
```

To run the seller on its own (Hardhat node on port **8545**, seller on 8080), from the repository root after `npx hardhat compile` and `(cd packages/x402 && npm install)`:

```bash
# terminal 1
npx hardhat node                                   # http://127.0.0.1:8545, chain 31337
# terminal 2: deploys MockERC20 and TurnpikeAllowance(token, depositCap 5.0), funds the owner account, sets the agent policy,
# allowlists the merchant, and prints CONTRACT=, TOKEN=, MERCHANT=
node examples/x402-seller/deploy-local.mjs
```

Then start the seller. Bash / Git Bash (environment-prefix syntax):

```bash
cd examples/x402-seller
CONTRACT=0x... TOKEN=0x... MERCHANT=0x... HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 PORT=8080 npm start
curl -i http://127.0.0.1:8080/v1/report     # 402 with a PAYMENT-REQUIRED header
```

PowerShell:

```powershell
cd examples/x402-seller
$env:CONTRACT="0x..."; $env:TOKEN="0x..."; $env:MERCHANT="0x..."
$env:HMAC_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:RPC_URL="http://127.0.0.1:8545"; $env:CHAIN_ID="31337"; $env:PORT="8080"
npm start
curl.exe -i http://127.0.0.1:8080/v1/report
```

`MERCHANT` is only an address. Generate `HMAC_SECRET` locally; never commit it. On a fresh node the deploy script prints the same addresses every time (`CONTRACT=0xe7f1…0512`, `TOKEN=0x5FbD…0aa3`, `MERCHANT=0x3C44…93BC`).

Environment variables read by `src/main.ts`:

| Variable | Default | Meaning |
|---|---|---|
| `CONTRACT`, `TOKEN`, `MERCHANT`, `HMAC_SECRET` | required | vault, token, payee address, challenge HMAC secret (at least 32 bytes) |
| `RPC_URL` | `http://127.0.0.1:8545` | chain RPC |
| `CHAIN_ID` | `31337` | chain id |
| `PORT` | `8080` | listen port (127.0.0.1) |
| `DB_PATH` | `./seller.sqlite` | SQLite file for challenges and stored responses |
| `PRICE_BASE` | `2500` | price of `GET /v1/report` in base units (6 decimals: 0.0025) |
| `CONFIRMATIONS` | `1` | confirmations before settle. The example defaults to 1 for a local chain; the middleware default is 2 |
| `PUBLIC_ORIGIN` | unset | public origin (`x402.publicOrigin`), e.g. `https://api.example.com`. Required when `NODE_ENV=production`: the middleware throws at start-up without it or on an invalid value |
| `PUBLIC_BASE_PATH` | unset | public prefix removed by a reverse proxy (`x402.basePath`), e.g. `/api` |

## Production notes

- `PUBLIC_ORIGIN` sets `x402.publicOrigin` (O4). With `NODE_ENV=production` the middleware throws at start-up when it is missing or invalid (not https, http outside localhost, a path, query, fragment, userinfo, wildcard or several origins). In development it prints one loud warning and compares `resource.url` by path and query only.
- `Host`, `X-Forwarded-*` and Express `trust proxy` never decide the advertised or accepted origin. Behind a proxy that serves the API under a prefix, set `PUBLIC_BASE_PATH` (for example `/api`).
- `guard: true` and `replayWindowSeconds: 86400` are set, as recommended for public x402 endpoints.
- Only clients that register `turnspike-allowance` can pay. Stock `exact` clients cannot.

See `packages/x402/README.md` and `docs/x402/SCHEME.md`.
