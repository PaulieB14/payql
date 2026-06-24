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
- **Bounded & predictable.** Queries are ~$0.01, and the per-query cap defaults to $0.01 — so an agent never pays more than the going rate. A price preflight and a clear "fund your wallet" message round it out.

## How it works

```
agent → search_subgraphs("uniswap v3")     → ranked live subgraphs (+ ids)
      → get_payment_info(id)                → "$0.01 USDC" (no payment)
      → query_subgraph(id, "{ ... }")       → data + receipt (tx hash, amount)
```

Discovery is ranked by on-chain curation signal (a popularity proxy) so you get the *live, used* subgraph, not a dead fork.

## Tools

| Tool | Cost | What it does |
|------|------|--------------|
| `search_subgraphs` | ~$0.01 (x402) † | Find live subgraphs by keyword/protocol, ranked by curation signal. Returns `subgraph_id`, `ipfsHash`, signal, query fees, query URL. |
| `get_payment_info` | **free** | Preflight a subgraph: returns the USDC price, `payTo`, network and whether it's within your cap — **without paying**. |
| `query_subgraph` | ~$0.01 (x402) | Run a GraphQL query, paying via x402. Returns the data + a payment receipt. Enforces the spend cap; returns a fund-wallet message if balance is short. |
| `get_subgraph_schema` | ~$0.01 (x402) | List a subgraph's root queryable entities (GraphQL introspection of the target subgraph). |
| `wallet_status` | **free** | Payment mode, wallet address, USDC/ETH balance, spend cap, funding instructions. Never reveals the key. |

**x402 is the only payment — there are no API keys, subscriptions, or platform fees.** A `~$0.01` row just means that call runs a GraphQL query through the gateway, billed as the same per-query x402 micropayment; `get_payment_info` and `wallet_status` don't touch the gateway, so they're free.

† `search_subgraphs` becomes **free** when `PAYQL_REGISTRY_URL` points at a free discovery source (e.g. your own subgraph registry). `get_subgraph_schema` introspects through the gateway, so it's always an x402 query.

---

## Example — end to end

A typical agent loop is **discover → price → query**. Tool calls take JSON arguments; results come back as JSON. (The `get_payment_info` output below is a real preflight against the live gateway; search/query payloads are abridged for illustration.)

**1. Find the right subgraph**

```jsonc
// call → search_subgraphs
{ "query": "uniswap v3", "first": 3 }
```
```jsonc
// result (abridged) — ranked by on-chain curation signal
{
  "ok": true,
  "source": "x402:graph-network-subgraph",
  "count": 3,
  "results": [
    {
      "displayName": "Uniswap V3",
      "subgraphId": "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
      "ipfsHash": "QmZ...",
      "currentSignalledTokensGRT": 48210.5,
      "queryFeesGRT": 1203.7,
      "categories": ["DeFi", "DEX"],
      "queryUrl": "https://gateway.thegraph.com/api/x402/subgraphs/id/5zvR82Qo..."
    }
  ],
  "payment": { "paid": true, "amountUsd": 0.01, "txHash": "0x9f…", "network": "eip155:8453" }
}
```

**2. Check the price — free, no payment**

```jsonc
// call → get_payment_info
{ "subgraph_id": "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" }
```
```jsonc
// result — real live preflight; the price comes from the 402 challenge
{
  "ok": true,
  "paywalled": true,
  "priceUsd": 0.01,
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "payTo": "0x79DC34E41B2b591078d3dE222C43EcaaBD52FcCB",
  "network": "eip155:8453",
  "scheme": "exact",
  "withinCap": true,
  "capUsd": 0.01
}
```

**3. Run the query — pays $0.01 USDC, gasless**

```jsonc
// call → query_subgraph
{
  "subgraph_id": "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
  "query": "{ pools(first: 2, orderBy: volumeUSD, orderDirection: desc) { token0 { symbol } token1 { symbol } volumeUSD } }"
}
```
```jsonc
// result — data + a payment receipt (tx hash + amount actually paid)
{
  "ok": true,
  "data": {
    "pools": [
      { "token0": { "symbol": "USDC" }, "token1": { "symbol": "WETH" }, "volumeUSD": "1234567890.12" },
      { "token0": { "symbol": "WBTC" }, "token1": { "symbol": "WETH" }, "volumeUSD": "987654321.00" }
    ]
  },
  "payment": { "paid": true, "amountUsd": 0.01, "txHash": "0xabc123…", "network": "eip155:8453" }
}
```

**If the wallet is empty**, you don't get a silent failure — you get what you owe and how to fund it:

```jsonc
{
  "ok": false,
  "error": "insufficient_funds",
  "message": "Need 0.0100 USDC for this query but the wallet holds 0.0000 USDC.\n\nThis wallet needs USDC on base ... (gasless: USDC only, no ETH) ... Ways to fund: ..."
}
```

**Check the wallet anytime** with `wallet_status` → `{ "paymentMode": "wallet", "address": "0x…", "usdcBalance": "5.000000", "gaslessPayments": true, "maxUsdPerQuery": 0.01 }`

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
        "PAYQL_MAX_USD_PER_QUERY": "0.01"
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
  -e PAYQL_MAX_USD_PER_QUERY=0.01 \
  -- node /ABSOLUTE/PATH/payql/dist/index.js
```

**Cursor** — same block as Claude Desktop in `~/.cursor/mcp.json`.

> Once published to npm you can swap `"command": "node", "args": ["…/dist/index.js"]` for `"command": "npx", "args": ["-y", "payql"]`.

---

## Wallet modes — BYO, harness, or managed (Ampersend)

PayQL supports all three through the *same* x402 interface — *which* wallet pays is just config. Set `PAYQL_PAYMENT_MODE`:

- **`wallet` (default, BYO)** — sign payments with `PAYQL_PRIVATE_KEY`. Works in any harness, zero extra deps. This is the floor.
- **`harness`** — *don't* hold a key. PayQL returns the payable URL + the 402 quote, and your wallet-equipped harness (e.g. an agent with a `pay-for-service` skill) settles it. The server never touches a key.
- **`managed` (Ampersend)** — pay through an [Ampersend](https://ampersend.ai)-managed smart account, with **spend limits, allowlists and auto-top-ups enforced server-side by Ampersend** — not just PayQL's local cap. See below.

You don't have to choose globally — the same build does all three depending on config.

### Using Ampersend (optional)

[Ampersend](https://github.com/edgeandnode/ampersend-sdk) (by Edge & Node) is a control layer for agent payments built on x402: per-transaction / daily / monthly limits, seller allowlists, auto-top-ups, and self-custodied keys. PayQL integrates it as an **opt-in** dependency — it is never installed or loaded unless you choose this mode.

1. **Install the SDK** (only for this mode):
   ```bash
   npm i @ampersend_ai/ampersend-sdk
   ```
2. **Create an agent + smart account** in Ampersend and set its spend policy ([docs.ampersend.ai](https://docs.ampersend.ai)). You'll get a **smart-account address** and a **session key**.
3. **Configure PayQL:**
   ```bash
   PAYQL_PAYMENT_MODE=managed
   PAYQL_WALLET_PROVIDER=ampersend
   PAYQL_AMPERSEND_SMART_ACCOUNT=0xYourSmartAccount
   PAYQL_AMPERSEND_SESSION_KEY=0xYourSessionKey     # or set AMPERSEND_AGENT_ACCOUNT / AMPERSEND_AGENT_KEY
   # PAYQL_AMPERSEND_API_URL=...                    # optional; defaults to Ampersend production
   ```

Now every paid query is authorized against your Ampersend policy **before** it's signed — exceed a limit or hit a disallowed payee and Ampersend declines it, which PayQL surfaces as a clear message. Funding/top-ups live in Ampersend, so the BYO "fund your wallet" path doesn't apply.

> Built against `@ampersend_ai/ampersend-sdk@0.0.28` (pre-1.0). Its `createAmpersendHttpClient(...)` returns an x402 client that PayQL hands into the very same `wrapFetchWithPayment` path it uses for BYO. The SDK bundles its own `@x402/*` (v2); if a future version diverges, pin and re-verify.

## Funding (USDC only — no gas)

x402 payments are gasless, so the floor to *use* PayQL is **USDC on Base**. To fund the wallet shown by `wallet_status`:

- **Easiest — Ampersend managed wallet.** Use `managed` mode ([Using Ampersend](#using-ampersend-optional)): Ampersend creates the wallet, enforces spend limits, and **auto-tops-up** USDC — no separate funding step.
- In a wallet-enabled harness, run its **fund/onramp skill** and deposit USDC.
- Buy **USDC on Base via any fiat onramp**, withdrawing to the address.
- Already on Base? **Send USDC** to the address (or swap ETH→USDC, then send).
- Cross-chain? **Bridge USDC to Base via Circle CCTP.**

> Fiat onramps require KYC, so they're a *human* setup step — an autonomous agent can't onramp itself. Seed the wallet once (or pre-fund it); the agent then runs on USDC and can self-top-up by swapping. ETH is only needed if the wallet itself does an on-chain swap/bridge/transfer — never to pay a query.

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `PAYQL_NETWORK` | `base` | `base` or `base-sepolia` |
| `PAYQL_PAYMENT_MODE` | `wallet` if key set, else `harness` | `wallet` \| `harness` \| `managed` |
| `PAYQL_PRIVATE_KEY` | — | BYO Base wallet key (or `X402_PRIVATE_KEY`). Never logged. |
| `PAYQL_MAX_USD_PER_QUERY` | `0.01` | Max you'll pay per query. Defaults to the $0.01 rate so you never pay more; a higher quote is refused (preflight shows it first). |
| `PAYQL_REGISTRY_URL` | — | Optional free GraphQL endpoint for discovery. |
| `PAYQL_WALLET_PROVIDER` | — | Set to `ampersend` (with `PAYQL_PAYMENT_MODE=managed`) to pay via an Ampersend-managed wallet. |
| `PAYQL_AMPERSEND_SMART_ACCOUNT` / `PAYQL_AMPERSEND_SESSION_KEY` | — | Ampersend smart-account address + session key (or `AMPERSEND_AGENT_ACCOUNT` / `AMPERSEND_AGENT_KEY`). Needs `npm i @ampersend_ai/ampersend-sdk`. |
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
