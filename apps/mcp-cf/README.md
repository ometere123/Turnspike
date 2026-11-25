# Turnspike MCP on Cloudflare (read-only)

A hosted version of `packages/mcp` with its three read-only tools. It has no key, no secret and no payment tool: hosting payments would mean holding other people's keys. It prices only Turnspike's own gateway. Paying stays in the local package.

`npm ci && npm test` runs it in workerd against a local chain. Deploying is a separate, approved step.
