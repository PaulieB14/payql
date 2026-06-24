---
name: payql
description: "Get live on-chain data from The Graph, paid per query in USDC over x402 — gasless, keyless, bring-your-own-wallet. Discover the right live subgraph, see the ~$0.01 price, then pull the data in one loop. Trigger keywords: subgraph, The Graph, GraphQL, on-chain data, DeFi, DEX, pool, TVL, swap, NFT, ENS, token holders, governance, x402, pay per query, USDC, Base, gateway."
version: 0.1.0
homepage: https://github.com/PaulieB14/payql
metadata:
  clawdbot:
    emoji: "💸"
---

# PayQL — pay-per-query data from The Graph

Get **live on-chain data** from The Graph's subgraphs (DeFi, DEX pools, NFTs, ENS, tokens, governance — 15,000+ subgraphs across 20+ chains), paying ~**$0.01 USDC per query** over [x402](https://x402.org). **No API key, no account, no ETH for gas** — the payment *is* the auth, and it's gasless (EIP-3009 `transferWithAuthorization` on Base).

## The loop: discover → price → query

1. **Discover** the right *live* subgraph for a protocol — ranked by on-chain curation signal, so you skip dead forks.
2. **Price** it — preflight the `402` challenge to read the exact USDC cost *before* paying (free).
3. **Query** — send GraphQL, pay the `402` from your wallet, get the data + a receipt back.

## Two ways to run it

### A. PayQL MCP server (turnkey)

Install and wire into your harness (Claude Desktop / Code / Cursor):

```jsonc
{
  "mcpServers": {
    "payql": {
      "command": "npx",
      "args": ["-y", "payql"],
      "env": { "PAYQL_NETWORK": "base", "PAYQL_PRIVATE_KEY": "0xYOUR_BASE_WALLET_KEY" }
    }
  }
}
```

Tools: `search_subgraphs`, `get_payment_info` (free price quote), `query_subgraph` (paid), `get_subgraph_schema`, `wallet_status`. Full recipe + example queries in [references/gateway.md](references/gateway.md).

### B. No install — use your harness's own wallet

If your harness already has an x402 / `pay-for-service` capability, hit the gateway directly:

- **Gateway URL:** `https://gateway.thegraph.com/api/x402/subgraphs/id/<SUBGRAPH_ID>`
- POST GraphQL `{"query":"..."}`. On `402`, pay the quoted USDC amount and retry — your x402 client does this automatically.

Full no-install recipe (discovery query, pricing, examples) in [references/gateway.md](references/gateway.md).

## Wallet & funding

Fund a Base wallet with **USDC only** — payments are gasless, so no ETH is required. Want spend caps/allowlists? Use an [Ampersend](https://ampersend.ai)-managed wallet (see the [PayQL README](https://github.com/PaulieB14/payql#using-ampersend-optional)). The per-query cost is **$0.01** — there are no API keys, subscriptions, or platform fees; the x402 micropayment is the only cost.
