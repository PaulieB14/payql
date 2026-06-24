# PayQL Playground

A tiny web demo that lets anyone **try x402-paid queries on The Graph** in the browser — and watch the payment loop happen transparently:

> ask → **discover** the subgraph → **402** ($0.01) → **pay** (gasless) → **live data + tx hash**

No LLM — guided prompts. **Free preview, pay-to-run:**

- Pick a question → see the exact **subgraph + GraphQL query + live price** in the chat, **free** (the price is read from the gateway's *unpaid* 402, so it costs nothing).
- **Run it** → connect an injected wallet and pay the **$0.01 yourself**, in-browser. Each payment is a single EIP-3009 signature for an **exact $0.01** — never a token approval/allowance, so the site can't drain anything. Results appear. The hub never holds funds or pays for anyone.

It runs the exact flow that [`npx -y payql`](https://github.com/PaulieB14/payql) runs inside an agent. No server wallet required.

## Run

```bash
cd web
npm install
cp .env.example .env      # set DEMO_PRIVATE_KEY (a Base wallet funded with a few $ of USDC)
npm start                 # http://localhost:3000
```

- `DEMO_PRIVATE_KEY` — a **dedicated** small Base wallet (USDC only; gasless). Each query spends ~$0.01.
- `DEMO_MAX_QUERIES` — global cap so the wallet can't be drained (default 200).
- The key is server-side only — the browser never sees it; payments happen in `/api/query`.

## Deploy

It's a plain Node service — deploy to Railway / Render / Fly, or Vercel (Node server). Set `DEMO_PRIVATE_KEY` + `DEMO_MAX_QUERIES` as env vars. Use a low-balance demo wallet and keep the cap conservative.

## How it works

`server.js` exposes `/api/examples` (the guided prompts) and `/api/query` (runs one). The payment logic in `lib/x402.js` is the same as PayQL: read the gateway's base64 `payment-required` 402 header for the price, then pay via `@x402/fetch` + `@x402/evm` (EIP-3009, gasless) and return the data + the settlement tx. Add more prompts in `lib/examples.js`.
