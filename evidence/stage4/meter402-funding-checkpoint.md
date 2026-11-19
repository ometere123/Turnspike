# Meter402 — Funding Checkpoint

Date: 2026-11-19  
Network: QIE Mainnet  
Chain ID: 1990

## Independent pre-funding checks

- RPC 1: `https://rpc1mainnet.qie.digital` → chain ID `1990`; QUSDC runtime hash `0x86c3675b798fef82ca801afa2f12eae09dfaa68772389ef78fa33cf18a649510`.
- RPC 2: `https://rpc2mainnet.qie.digital` → chain ID `1990`; identical QUSDC runtime hash.
- Independent compile: Solidity `0.8.20`, optimizer disabled, EVM `berlin`; deployed runtime and compiled runtime both 6,096 bytes. After removing the 51-byte CBOR metadata trailer, executable-core hash for both is `0xbbcea2fb7aec43b022be6326432ed4edf0f53b688bfac218f4c1792ae27dece5`.
- “Stub Token (goerli)” remains documented as an explorer metadata anomaly, not a current blocker.

## Secure throwaway wallets

Primary/owner wallet: `0x77918289D518303DDE4f84098B507bdB1dc73E4C`  
Explorer: https://mainnet.qie.digital/address/0x77918289D518303DDE4f84098B507bdB1dc73E4C  
Current QIE balance: `0`  
Current QUSDC balance: `0` base units (`0 QUSDC`)

Second/agent wallet: `0xF35F4facb4c9e0ceb836bF350203F67F290F6433`  
Explorer: https://mainnet.qie.digital/address/0xF35F4facb4c9e0ceb836bF350203F67F290F6433  
Current QIE balance: `0`  
Current QUSDC balance: `0` base units (`0 QUSDC`)

Both are new encrypted Foundry keystores under the local user profile, separate from `PAPITO`. A fixed-message signing check succeeded for the primary wallet. No private key or password is included here.

## Funding request

Fund the primary/owner wallet with:

- Recommended QIE: `0.020 QIE`
- Recommended QUSDC: `0.20 QUSDC` = `200,000` base units

Fund the second/agent wallet with:

- Recommended QIE: `0.005 QIE`
- QUSDC: none required initially

The QIE recommendation is conservative relative to the observed `1.125 gwei` gas price and covers deployment, token approvals/transfers, policy calls, failed transaction attempts, and the ten receipt tests with contingency. The QUSDC recommendation covers the exact `0.01 QUSDC` transfer, transferFrom allowance testing, a small policy deposit, and ten small payments while retaining contingency.

Reply exactly: **Funded. Continue.**

No transaction has been submitted. Execution is paused pending independent balance verification after funding.
