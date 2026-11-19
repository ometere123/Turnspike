# M8: agent SDK buying from the hosted gateway on QIE Mainnet

Date: 2026-11-19. Real mainnet transaction, project-operated wallets (owner 0x7791…3E4C, agent 0xF35F…6433, merchant 0xceeF…B761). Not an external user.

Command: `node examples/node-agent/dist/agent.js` with TARGET_URL=https://turnspike-qie.fly.dev/v1/block-summary, agent key from an encrypted Foundry keystore (password from a DPAPI-protected file, never printed), PURCHASE_KEY=evidence-node-agent-1, confirmations 2.

## First run (paid, 15 s end to end)
```
paying 0.001 QUSDC to 0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761 for block-summary (gas ~109273500000000 wei)
{"evt":"payment_broadcast","requestId":"0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa","txHash":"0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7"}
{"evt":"payment_confirmed","requestId":"0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa","txHash":"0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7","blockNumber":12015683}
{"evt":"delivered","requestId":"0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa","status":200}
{"blockNumber":12015685,"timestamp":1795079698,"txCount":0,"chainId":1990,"source":"QIE RPC (live)"}
paid: https://mainnet.qie.digital/tx/0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7
```

## Second run with the same key (no second payment)
```
{"evt":"resume","key":"evidence-node-agent-1","state":"delivered"}
{"evt":"delivered","requestId":"0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa","status":200}
paid: https://mainnet.qie.digital/tx/0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7 (stored response replayed)
{"blockNumber":12015685,"timestamp":1795079698,"txCount":0,"chainId":1990,"source":"QIE RPC (live)"}
```

## Verified with the CLI: `turnspike api verify 0x7e41ccaa…21b7`
```
status        success in block 12015683 (92 confirmations)
gas           92159 used, 0.000103678875 QIE
payment       0.001 QUSDC from owner 0x77918289D518303DDE4f84098B507bdB1dc73E4C
              agent 0xF35F4facb4c9e0ceb836bF350203F67F290F6433 -> merchant 0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761
              requestId 0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa
explorer      https://mainnet.qie.digital/tx/0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7
```

Gas: 92,159 units at 1.125 gwei = 0.000104 QIE. Price: 0.001 QUSDC.
