# Browser end-to-end test of the wallet app (apps/web /app)

Date: 2026-11-19. Method: the production build of apps/web, pointed at a LOCAL Hardhat node that reports chain ID 1990 (`hardhat.e2e.config.ts`), with the real `TurnpikeAllowance` contract and the labelled `MockERC20` test double deployed by `scripts/e2e-setup.ts`. A minimal EIP-1193 provider (`scripts/e2e-mock-wallet.js`) was injected into the page; it forwards to the node's unlocked accounts. Driven in the Claude desktop app's built-in browser.

## What this does and does not prove
- It exercises the app's real code paths (ethers `BrowserProvider`, ABI encoding, gas estimation, confirmation dialog, receipts, event-log reads) against the real contract bytecode.
- It does NOT test QIE Wallet or MetaMask, mainnet, or real-money transactions from the UI. The mock wallet is a test double.

## Results (observed)
| Check | Observed |
|---|---|
| Connect, read balances | Wallet QUSDC 100, allowance 0, deposit cap 5 |
| Approve then deposit 2 QUSDC | Two-step flow; "1. Approve QUSDC" became "Deposit"; dialog showed the amount and an estimated fee; allowance balance 2 |
| Set agent and limits (0.01 / 0.05) | Confirmed; status Active, agent shown |
| Allow merchant | Confirmed; merchant listed on the allowlist |
| Pause, unpause | Status Paused, then Active |
| Withdraw 0.5 | Allowance balance 1.5 |
| Revoke agent | Status "No agent" |
| Wallet rejection at signature | Message "You rejected the request in your wallet. Nothing was sent."; no transaction |
| Zero QIE balance | Refused before the dialog: "Not enough QIE for gas. You have 0.0 QIE and need about ..." |
| Input validation | Over wallet balance, over deposit cap, more than 6 decimals each blocked with a specific message |
| Wrong network (chain 0x1) | Banner shown, all transaction buttons disabled; "Switch network" restored chain 1990 |
| Account change in the wallet | Owner, balances and history reset to the new account (no stale values) |
| Disconnect | Connect card shown and `turnpike.disconnected` stored so a reload does not auto-reconnect |
| Reconnect, history | Activity listed all 8 owner transactions with matching block numbers, read from event logs |

## Layout and accessibility checks (production build, local)
- No horizontal overflow on any of the 8 routes at widths 360, 768, 1024 and 1440 (found and fixed: site navigation overflowed at 768, now collapses below 1024).
- A scripted check of accessible names, heading order, landmarks and text contrast found two low-contrast warning texts in light mode (fixed by darkening the warning, success and danger colours) and none in dark mode. This is a hand-written check, not axe-core.

## Not covered
Real browser wallets, mobile wallet apps, mainnet transactions initiated from the UI, long-pending transactions (the 60 s notice is implemented but not exercised), and screen-reader testing with assistive technology.
