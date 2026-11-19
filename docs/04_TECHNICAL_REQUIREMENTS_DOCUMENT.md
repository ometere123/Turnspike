# 04 — Technical Requirements Document

## 1. Chain and token facts
| Fact | Value | Status |
|---|---|---|
| Mainnet chain ID | 1990 (testnet 1983) | VERIFIED (Stage 4) |
| RPC | https://rpc1mainnet.qie.digital, https://rpc2mainnet.qie.digital | rpc1 VERIFIED; rpc2 ASSUMED |
| Explorer | https://mainnet.qie.digital (Etherscan-style API: `getsourcecode`, `checkverifystatus`) | VERIFIED |
| QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, 6 decimals, not proxy, standard ERC-20 in tested paths, no fee seen | VERIFIED |
| QUSDC risks | role-controlled mint/burn (`VAULT_ROLE`); pause/blacklist behaviour not checked; explorer shows "Stub Token (goerli)" label | trust risk; pause/blacklist REQUIRES EXECUTION TEST |
| Block time | ≈3.63 s average; receipt delays 3.0–6.4 s in 5 of 10 samples | VERIFIED |
| Gas price | ≈1.0–2.25 gwei observed | VERIFIED |
| Failed-call gas | 90,000 gas shown on reverted calls, unexplained | REQUIRES EXECUTION TEST |
| Finality / reorg behaviour | unknown | REQUIRES EXECUTION TEST (TEST-X01) |
| Oracle | supports BTC, ETH, XRP, SOL, QIE, XAUt, BNB only; AggregatorV3-style; **feed addresses and decimals not verified** | addresses BLOCKED until looked up in QIE docs / explorer |
| EVM version | Solidity 0.8.20 deployed under EVM "berlin" setting; compile with `evmVersion: berlin` to be safe | ASSUMED (REQUIRES EXECUTION TEST: deploy with default `paris`) |

## 2. Technology decisions (locked)
| Layer | Choice | Reason |
|---|---|---|
| Contract | Solidity 0.8.20, OpenZeppelin (`SafeERC20`, `ReentrancyGuard`), Hardhat + TypeScript | matches Stage 4 deployment; explorer verification proven for 0.8.20 |
| Gateway | Node LTS, TypeScript, Express, zod, ethers v6, better-sqlite3 | small, familiar, synchronous SQLite transactions simplify idempotency |
| Playground | React + Vite, injected-wallet via ethers `BrowserProvider` | QIE Wallet compatibility ASSUMED (INT-005); MetaMask-style provider as fallback |
| Deploy | Docker, one persistent volume, a public HTTPS host (provider TBD, OD-4) | judges need a public URL |
| CI | GitHub Actions: compile, test, lint | repo evidence |
| Tests | Hardhat (Chai), Vitest for gateway, Playwright smoke | |

Note: this stack was proposed in 00 and is locked here; changes need change control.

## 3. Interfaces (requirement IDs)
| ID | Interface | Requirement |
|---|---|---|
| INT-001 | JSON-RPC to QIE (`eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_call`, `eth_chainId`) | verify `chainId == 1990` on startup |
| INT-002 | QUSDC `transferFrom`/`balanceOf`/`allowance`/`approve` | owner approves contract once; contract pulls on deposit |
| INT-003 | Explorer verification API | source verified for the final contract; record GUID/status |
| INT-004 | QIE Oracle feed `latestRoundData()`/`decimals()` | optional, P1; see FR-018 |
| INT-005 | Wallet (owner flows) | use `eth_requestAccounts`, `wallet_switchEthereumChain` (1990) ASSUMED supported |
| INT-006 | HTTP 402 protocol (Turnpike-specific JSON; not x402-compatible) | defined in [06](06_DATA_MODELS_AND_INTERFACES.md) |

## 4. Configuration parameters (defaults, all configurable)
| Name | Default | Notes |
|---|---|---|
| `CONFIRMATIONS` | 2 | pending until reached; revise after TEST-X01 |
| `CHALLENGE_TTL_SECONDS` | 300 | requestId expiry |
| `PRICE_A_BASE_UNITS` | 1000 | 0.001 QUSDC |
| `ORACLE_MAX_AGE_SECONDS` | 3600 | placeholder; set after reading feed heartbeat (unverified) |
| `PER_ACCOUNT_DEPOSIT_CAP` | 5,000,000 base units (5 QUSDC) | contract constructor immutable |
| `RATE_LIMIT` | 60 req/min/IP | |
| `HMAC_SECRET` | env only, ≥32 bytes | never committed |
Units: 1 QUSDC = 1,000,000 base units (the Stage 4 report mislabelled 100,000 as 1 QUSDC; correct value is 0.1 QUSDC).

## 5. Constraints
No real credentials in repo; funds only in dedicated low-value demo wallets; every mainnet spend within small caps; no mocks substituting mandatory real integrations (mocks allowed only in unit tests, labelled).
