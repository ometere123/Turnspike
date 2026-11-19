# Express API with Turnspike payments

A complete, runnable example: two paid routes behind `turnspike()` and one free health route.

```bash
# 1. build the middleware package (it is not published to npm yet)
cd packages/middleware && npm install && npm run build && cd ../..

# 2. install and build the example
cd examples/express-api
npm install
npm run build

# 3. run it
export MERCHANT_ADDRESS=0xYourReceivingAddress
export HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
npm start

# 4. an unpaid request returns the real 402 challenge
curl -i http://localhost:3001/v1/quote
```

Defaults point at the Turnspike contract and QUSDC on QIE Mainnet (chain 1990). To charge real money your `MERCHANT_ADDRESS` must be an address you control, and the paying owner must allowlist it with `setMerchant` on the contract (the Turnspike app does this).

What a client does next is described in the developer guide: pay with `pay(owner, merchant, requestId, amount)` on the contract, then retry with `X-Payment: base64({requestId, txHash, sig})`.

Security notes:
- The `sig` returned in the 402 is the secret half of the proof. Anyone holding `requestId`, `txHash` and `sig` can fetch the stored response, so do not put per-customer private data behind a Turnspike route unless you also authenticate the caller.
- Handlers should be idempotent. After a crash mid-handler the gateway re-runs it once the delivery lease expires.
