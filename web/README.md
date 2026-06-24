# PayQL Playground

A tiny web demo that lets anyone **try x402-paid queries on The Graph** in the browser — and watch the payment loop happen transparently:

> ask → **discover** the subgraph → **402** ($0.01) → **pay** (gasless) → **live data + tx hash**

No LLM (guided prompts), no login, no wallet needed by the visitor — a small demo wallet pays each ~$0.01 query so people can *experience* x402-on-The-Graph before adopting it. It runs the exact flow that [`npx -y payql`](https://github.com/PaulieB14/payql) runs inside an agent.

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
