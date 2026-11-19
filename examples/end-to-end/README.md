# End-to-end: seller and agent on a local chain

`run.mjs` performs the full two-sided journey with the **built** packages, on a throwaway Hardhat chain:
deploys the real allowance contract and a labelled test token (MockERC20), funds an owner with limits, starts an Express API
protected by `@turnspike/middleware`, and buys from it with `@turnspike/client`. It then checks that a repeat purchase
replays without a second charge, that invalid input is refused before a price is quoted, and that the agent's price ceiling holds.

```bash
npm ci --legacy-peer-deps && npx hardhat compile
(cd packages/middleware && npm install && npm run build)
(cd packages/client && npm install && npm run build)
node examples/end-to-end/run.mjs     # prints END-TO-END OK
```
CI runs this on every push. It never touches mainnet.
