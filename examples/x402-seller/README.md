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

To run the seller on its own, start `npx hardhat node`, deploy `TurnpikeAllowance` and `MockERC20` (see `examples/x402-agent/src/local-demo.ts`), then:

```bash
cd examples/x402-seller
CONTRACT=0x... TOKEN=0x... MERCHANT=0x... HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 PORT=8080 npm start
curl -i http://127.0.0.1:8080/v1/report     # 402 with a PAYMENT-REQUIRED header
```

`MERCHANT` is only an address. Generate `HMAC_SECRET` locally; never commit it.

## Production notes

- Behind a proxy, set `PUBLIC_ORIGIN` (it configures `x402.resourceUrl`) or Express `trust proxy`.
- `guard: true` and `replayWindowSeconds: 86400` are set, as recommended for public x402 endpoints.
- Only clients that register `turnspike-allowance` can pay. Stock `exact` clients cannot.

See `packages/x402/README.md` and `docs/x402/SCHEME.md`.
