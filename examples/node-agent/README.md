# Node agent buying a Turnspike API

A buyer that pays for a Turnspike endpoint with `@turnspike/client`. It holds only the agent key, from an encrypted keystore.
This exact program bought from the hosted gateway on QIE Mainnet; the run is recorded in `evidence/M8_sdk_mainnet.md`.

```bash
cd packages/client && npm install && npm run build && cd ../../examples/node-agent
npm install && npm run build

export TARGET_URL=https://turnspike-qie.fly.dev/v1/block-summary
export MERCHANT_ADDRESS=0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761   # the only payee this agent will pay
export OWNER_ADDRESS=0xYourOwner                                     # the owner who set this agent's limits
export AGENT_KEYSTORE=~/.foundry/keystores/my-agent                  # encrypted JSON keystore of the AGENT key
read -s TURNSPIKE_KEYSTORE_PASSWORD && export TURNSPIKE_KEYSTORE_PASSWORD
DRY_RUN=1 npm start     # quote only: price, gas, limits; nothing is sent
npm start               # pays 0.001 QUSDC and prints the data
```

Before it can pay, the owner must, in the web console: deposit QUSDC, set this agent with a per-call and daily cap, and allowlist the merchant. The agent address needs a little QIE for gas (one payment used 0.000104 QIE).

Rerunning with the same `PURCHASE_KEY` after a crash or timeout finishes the purchase instead of paying again. Exit codes: 0 delivered, 3 refused (nothing paid), 4 paid but not delivered yet (rerun later).
