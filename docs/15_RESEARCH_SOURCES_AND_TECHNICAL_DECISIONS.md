# 15 — Research Sources and Technical Decisions

## 1. Sources
| ID | Source | Used for | Reliability |
|---|---|---|---|
| S1 | Hackathon rules sheet supplied by the user (stated as verified against hackathon.qie.digital and Terms) | 01 | high; live Terms re-read pending (OD-6) |
| S2 | `meter402-qie-mainnet-final-report.md` (user upload; Stage 4 mainnet run, project then named Meter402) | chain ID, tx evidence, contract `0x6910…DdAC`, receipt timings, gas, limitations | primary evidence; I did not independently re-execute transactions; unit label error noted |
| S3 | QIE explorer (https://mainnet.qie.digital) source/ABI checks done earlier in this project | QUSDC properties (6 decimals, not proxy, VAULT_ROLE, Solidity 0.8.20) | checked during research |
| S4 | QIE Oracle documentation consulted earlier | supported assets list, AggregatorV3 style | feed addresses/decimals not found |
| S5 | Four external AI reviews supplied by the user, and the six-amendment review text | competitive framing, amendments | opinion, not primary |
| S6 | Hackathon 2 winner descriptions (organiser communications, via earlier web search) | SpendGrid etc. | secondary; SpendGrid code not read |
| S7 | Public descriptions of x402 and Coinbase agent wallets | competitor context | secondary; not re-verified in this session |
| S8 | OpenZeppelin Contracts (SafeERC20, ReentrancyGuard) | implementation libraries | well known; pin version at install |

No source in this list was fabricated; anything not retrieved is marked UNVERIFIED in the owning document.

## 2. Decision log
| ID | Decision | Alternatives | Reason |
|---|---|---|---|
| DEC-1 | No admin/global kill switch; owner-level pause only | admin-pausable contract | avoids hidden power; matches "no hidden trust" |
| DEC-2 | Fixed 24h bucket; document 2× boundary | rolling window | simpler, cheaper, auditable; limitation disclosed |
| DEC-3 | Pause blocks `pay` only; withdraw always allowed | pause also blocks withdraw | owner funds never stranded |
| DEC-4 | Used-key `(merchant, requestId)`; contract multi-tenant; `pay` takes `owner` | one contract per owner | fewer deployments; demo simplicity |
| DEC-5 | Turnpike-specific JSON 402 flow, not x402 | implement x402 | no verified QIE facilitator; scope |
| DEC-6 | Scripted agent, no LLM | LLM agent | reduces risk; AI track claim relies on autonomous agent behaviour, not on LLM |
| DEC-7 | Reuse mechanism/tests, deploy new contract | reuse deployed contract | multi-tenant state machine changes; amendment 6 |
| DEC-8 | SQLite on a volume | Postgres | single instance, synchronous transactions |
| DEC-9 | Confirmations configurable, default 2 | fixed | finality untested |
| DEC-10 | Endpoint A real chain-data read; Endpoint B oracle cut-able | oracle mandatory | amendment 5 |

Note on DEC-6: the AI-track fit is thinner without an LLM; OD-1 allows moving to Developer Infrastructure & Tooling if that fits better.
