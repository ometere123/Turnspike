# 11 — Development Setup and Deployment

## 1. Prerequisites
Node LTS, npm/pnpm, Docker, git, a wallet funded with small QIE (gas) and QUSDC, Hardhat via npm. Pin versions in `package.json`; commit lockfile.

## 2. Environment variables (`.env.example` only; real `.env` never committed)
`RPC_URL_1`, `RPC_URL_2`, `CHAIN_ID=1990`, `QUSDC_ADDRESS=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5`, `ALLOWANCE_ADDRESS`, `MERCHANT_ADDRESS`, `HMAC_SECRET`, `CONFIRMATIONS`, `CHALLENGE_TTL_SECONDS`, `DB_PATH`, `ORACLE_FEED_*` (unset until verified), `OWN_ADDRESSES` (for usage stats), `DEPLOYER_KEY`/`AGENT_KEY` (local only, shell env, never files committed).

## 3. Local workflow
1. `npm ci` → `npx hardhat test` (TEST-C).
2. Run local gateway against a Hardhat node with a test token (mock allowed here only).
3. Run the gateway against mainnet **reads** only (receipt fetching).

## 4. Mainnet deployment procedure (requires developer approval at step 2)
1. Dry run on local fork/network; record bytecode hash.
2. Developer approves spend budget (suggest ≤ 5 QUSDC and ≤ 1 QIE gas across all tests).
3. Deploy final contract with `depositCap`, QUSDC address; record address in `evidence/deployment.json`.
4. Verify source via explorer API (`checkverifystatus`), compiler 0.8.20, optimizer setting recorded, EVM version per TEST-X03.
5. Smoke: deposit, setPolicy, allowlist, one pay, one over-cap revert (replicating the Stage 4 pattern).
6. Publish addresses to README and evidence page.

## 5. Gateway deployment
Docker image; single instance; mount volume at `/data`; env via host secret manager; HTTPS terminated by host; health endpoint `/healthz`; backups of SQLite file nightly (best-effort); logs to stdout. Rollback: redeploy previous image; DB is forward-compatible (additive migrations only).

## 6. Repository hygiene
Branch `main` protected by CI; conventional commit messages; human-authored commit history (PR-2); LICENSE (MIT, OpenZeppelin MIT noted); `THIRD_PARTY.md`.
