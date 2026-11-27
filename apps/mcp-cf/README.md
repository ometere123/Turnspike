# Turnspike MCP on Cloudflare (read-only)

A hosted version of `packages/mcp` with its three read-only tools. It has no key, no secret and no payment tool: hosting payments would mean holding other people's keys. It prices only Turnspike's own gateway. Paying stays in the local package.

`npm ci && npm test` runs it in workerd against a local chain. It imports source from `packages/mcp` and `packages/client`, so `typecheck`, `build` and `test` first install and build those two packages if a fresh clone lacks them (`scripts/ensure-packages.mjs`). `test` also needs the repository root installed (`npm ci` at the root) for the local Hardhat chain; it compiles the contracts if they are missing and says so if the root is not installed. Live since 25 November 2026: https://turnspike-mcp.delealufejoel.workers.dev/mcp (checked in both protocol versions; `turnspike_pay` does not exist there). The rate limit is approximate: 2 of 90 quick requests were refused.
