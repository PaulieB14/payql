# PayQL

**Let any AI agent query The Graph and pay per query in USDC — gasless, keyless, bring-your-own-wallet.**

PayQL is an [MCP](https://modelcontextprotocol.io) server. Drop it into any MCP-capable harness (Claude Desktop, Claude Code, Cursor, …) and your agent can **discover the right subgraph**, **see the price**, and **pull live on-chain data** — paying ~$0.01 in USDC per query over [x402](https://x402.org), with **no API key, no account, and no ETH for gas**.

It's the missing glue between an agent harness (which brings the wallet) and The Graph's data (which is now pay-per-query). The hard part — *which of 40 forks is the live subgraph?* — is solved by ranking discovery on on-chain curation signal.

---

## Why this exists

The Graph's gateway now speaks x402: an unpaid request gets a `402 Payment Required`, the caller signs a USDC payment authorization, and the data comes back. No Studio signup, no key management — **the payment is the auth**. PayQL wires that pay-per-query loop into the agent's tool surface and adds the two things an agent actually needs around it: *finding* the right subgraph, and *not overspending*.

- **Gasless.** Payments use EIP-3009 `transferWithAuthorization` (the `exact` scheme on Base). You sign off-chain; the facilitator submits the tx and pays gas. **A USDC-only wallet is enough — no ETH.**
- **Keyless.** The x402 gateway path needs no API key or account.
- **Wallet-agnostic.** PayQL just speaks x402 — *which* wallet pays is config. BYO key, a managed/capped wallet (e.g. Ampersend), or hand the 402 to a wallet-equipped harness. Same code path.
- **Bounded.** A hard per-query USD cap, a price preflight, and a clear "fund your wallet" message when balance runs low.

## How it works

```
agent → search_subgraphs("uniswap v3")     → ranked live subgraphs (+ ids)
      → get_payment_info(id)                → "$0.01 USDC" (no payment)
      → query_subgraph(id, "{ ... }")       → data + receipt (tx hash, amount)
```

Discovery is ranked by on-chain curation signal (a popularity proxy) so you get the *live, used* subgraph, not a dead fork.

## Tools

| Tool | Paid? | What it does |
|------|-------|--------------|
| `search_subgraphs` | tiny | Find live subgraphs by keyword/protocol, ranked by curation signal. Returns `subgraph_id`, `ipfsHash`, signal, query fees, query URL. |
| `get_payment_info` | free | Preflight a subgraph: returns the USDC price, `payTo`, network and whether it's within your cap — **without paying**. |
| `query_subgraph` | yes | Run a GraphQL query, paying via x402. Returns the data + a payment receipt. Enforces the spend cap; returns a fund-wallet message if balance is short. |
| `get_subgraph_schema` | yes | List a subgraph's root queryable entities (GraphQL introspection). |
| `wallet_status` | free | Payment mode, wallet address, USDC/ETH balance, spend cap, funding instructions. Never reveals the key. |

> By default `search_subgraphs` / `get_subgraph_schema` run a tiny *paid* x402 query against The Graph's network subgraph. Point `PAYQL_REGISTRY_URL` at a free GraphQL discovery source (e.g. your own curated registry) to make discovery free.

---

## Install

### 1. Build it

```bash
git clone <this repo> && cd payql
npm install
npm run build
```

### 2. Add it to your harness

**Claude Desktop** — add to `claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "payql": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/payql/dist/index.js"],
      "env": {
        "PAYQL_NETWORK": "base",
        "PAYQL_PRIVATE_KEY": "0xYOUR_BASE_WALLET_KEY",
        "PAYQL_MAX_USD_PER_QUERY": "0.10"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add payql \
  -e PAYQL_NETWORK=base \
  -e PAYQL_PRIVATE_KEY=0xYOUR_BASE_WALLET_KEY \
  -e PAYQL_MAX_USD_PER_QUERY=0.10 \
  -- node /ABSOLUTE/PATH/payql/dist/index.js
```

**Cursor** — same block as Claude Desktop in `~/.cursor/mcp.json`.

> Once published to npm you can swap `"command": "node", "args": ["…/dist/index.js"]` for `"command": "npx", "args": ["-y", "payql"]`.

---

## Wallet modes — BYO, harness, or managed

PayQL supports all three through the *same* x402 interface. Set `PAYQL_PAYMENT_MODE`:

- **`wallet` (default, BYO)** — sign payments with `PAYQL_PRIVATE_KEY`. Works in any harness, zero dependencies. This is the floor.
- **`harness`** — *don't* hold a key. PayQL returns the payable URL + the 402 quote, and your wallet-equipped harness (e.g. an agent with a `pay-for-service` skill) settles it. The server never touches a key.
- **`managed`** — the `wallet` signing path, intended for a managed/capped wallet such as **Ampersend**. Set `PAYQL_WALLET_PROVIDER=ampersend`. (The signer is the configured key today; a remote-signer adapter is the clean extension point.)

You don't have to choose globally — the same build does all three depending on config.

## Funding (USDC only — no gas)

x402 payments are gasless, so the floor to *use* PayQL is **USDC on Base**. To fund the wallet shown by `wallet_status`:

- In a wallet-enabled harness, run its **fund/onramp skill** and deposit USDC.
- Card → USDC on Base via a **Coinbase/CDP onramp**, withdrawing to the address.
- Already on Base? **Send USDC** to the address (or swap ETH→USDC, then send).
- Cross-chain? **Bridge USDC to Base via Circle CCTP.**

> Fiat onramps require KYC, so they're a *human* setup step — an autonomous agent can't onramp itself. Seed the wallet once (or pre-fund it); the agent then runs on USDC and can self-top-up by swapping. ETH is only needed if the wallet itself does an on-chain swap/bridge/transfer — never to pay a query.

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `PAYQL_NETWORK` | `base` | `base` or `base-sepolia` |
| `PAYQL_PAYMENT_MODE` | `wallet` if key set, else `harness` | `wallet` \| `harness` \| `managed` |
| `PAYQL_PRIVATE_KEY` | — | BYO Base wallet key (or `X402_PRIVATE_KEY`). Never logged. |
| `PAYQL_MAX_USD_PER_QUERY` | `0.10` | Hard ceiling per query; quotes above are refused. |
| `PAYQL_REGISTRY_URL` | — | Optional free GraphQL endpoint for discovery. |
| `PAYQL_WALLET_PROVIDER` | — | Informational, e.g. `ampersend`. |
| `PAYQL_RPC_URL` / `PAYQL_GATEWAY_BASE` / `PAYQL_USDC_ADDRESS` / `PAYQL_NETWORK_SUBGRAPH_ID` | per-network | Advanced overrides. |

## Security

- The private key is read from env, used only to sign EIP-3009 authorizations, and **never written to logs or tool output**. `wallet_status` returns the address only.
- The per-query cap (`PAYQL_MAX_USD_PER_QUERY`) is enforced *before* any signature is produced.
- Prefer a dedicated low-balance hot wallet, or `harness`/`managed` mode, over a key with significant funds.

## Status

Built and verified against the **live** Graph x402 gateway (Base mainnet): the discover → preflight → price path is exercised end-to-end (`$0.01 USDC`, `exact`/`eip155:8453`, EIP-3009 gasless). The signed-settlement step runs through The Graph's official [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) client and requires a funded wallet to exercise.

Built on `@modelcontextprotocol/sdk`, `@x402/fetch` + `@x402/evm`, and `viem`.

## License

MIT
