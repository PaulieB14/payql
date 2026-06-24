#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatUnits } from "viem";
import { loadConfig } from "./config.js";
import { PaymentEngine, SpendCapError, InsufficientFundsError, type PaidResult } from "./x402.js";
import { searchSubgraphs, introspectSchema, subgraphUrl, gqlInit } from "./graph.js";
import { fundingGuidance } from "./wallet.js";

const cfg = loadConfig();
const engine = new PaymentEngine(cfg);

const server = new McpServer({ name: "payql", version: "0.1.0" });

function ok(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const error =
    err instanceof InsufficientFundsError
      ? "insufficient_funds"
      : err instanceof SpendCapError
        ? "spend_cap_exceeded"
        : "error";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error, message }, null, 2) }],
    isError: true,
  };
}

function receiptSummary(result: PaidResult | null | undefined) {
  if (!result) return null;
  if (result.needsHarnessPayment) {
    return {
      mode: "harness",
      paid: false,
      quoteUsd: result.quote?.amountUsd,
      payTo: result.quote?.payTo,
      network: result.quote?.network,
      note: "harness-pays mode (no wallet configured). Settle this 402 with your harness wallet, or set PAYQL_PRIVATE_KEY.",
    };
  }
  if (!result.paid) return { paid: false };
  return {
    paid: true,
    amountUsd: result.receipt?.amountUsd ?? result.quote?.amountUsd,
    txHash: result.receipt?.txHash,
    network: result.receipt?.network,
  };
}

// 1) Discover --------------------------------------------------------------
server.registerTool(
  "search_subgraphs",
  {
    title: "Search subgraphs",
    description:
      "Find live subgraphs on The Graph by keyword/protocol, ranked by on-chain curation signal (a popularity proxy). Use this to pick a subgraph_id before querying. By default this runs a tiny PAID x402 query against The Graph network subgraph; set PAYQL_REGISTRY_URL to use a free discovery source.",
    inputSchema: {
      query: z.string().describe("Protocol or keyword, e.g. 'uniswap v3', 'aave', 'ens'"),
      first: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
    },
  },
  async ({ query, first }) => {
    try {
      const { hits, result, source, errors } = await searchSubgraphs(engine, cfg, query, first ?? 10);
      return ok({ ok: !errors, source, count: hits.length, results: hits, errors: errors ?? undefined, payment: receiptSummary(result) });
    } catch (e) {
      return fail(e);
    }
  },
);

// 2) Price (no payment) ----------------------------------------------------
server.registerTool(
  "get_payment_info",
  {
    title: "Get query price",
    description:
      "Preflight a subgraph: return the USDC price, asset, payTo and network from the x402 402 challenge WITHOUT paying. Use to estimate cost or to drive a harness-side payment.",
    inputSchema: {
      subgraph_id: z.string().describe("Subgraph ID"),
      query: z.string().optional().describe("GraphQL query to price (defaults to a minimal _meta probe)"),
    },
  },
  async ({ subgraph_id, query }) => {
    try {
      const q = query ?? "{ _meta { block { number } } }";
      const quote = await engine.quote(subgraphUrl(cfg, subgraph_id), gqlInit(q));
      if (!quote) {
        return ok({ ok: true, paywalled: false, note: "Endpoint did not return a 402 (query may be free, or the subgraph_id is wrong)." });
      }
      return ok({
        ok: true,
        paywalled: true,
        priceUsd: quote.amountUsd,
        asset: quote.asset,
        payTo: quote.payTo,
        network: quote.network,
        scheme: quote.scheme,
        withinCap: quote.amountUsd <= cfg.maxUsdPerQuery,
        capUsd: cfg.maxUsdPerQuery,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// 3) Query (paid) ----------------------------------------------------------
server.registerTool(
  "query_subgraph",
  {
    title: "Query a subgraph (paid)",
    description:
      "Run a GraphQL query against a subgraph on The Graph, paying per query in USDC over x402 — gasless and keyless. Returns the data plus a payment receipt (tx hash + amount). Respects the per-query spend cap and returns a fund-wallet message if balance is insufficient.",
    inputSchema: {
      subgraph_id: z.string().describe("Subgraph ID (from search_subgraphs)"),
      query: z.string().describe("GraphQL query"),
      variables: z.record(z.any()).optional().describe("Optional GraphQL variables"),
    },
  },
  async ({ subgraph_id, query, variables }) => {
    try {
      const result = await engine.paidFetch(subgraphUrl(cfg, subgraph_id), gqlInit(query, variables));
      if (result.needsHarnessPayment) {
        return ok({
          ok: true,
          paid: false,
          needsHarnessPayment: true,
          quote: result.quote,
          queryUrl: subgraphUrl(cfg, subgraph_id),
          payment: receiptSummary(result),
        });
      }
      const body = result.data;
      const errors = body?.errors;
      return ok({ ok: !errors, data: body?.data ?? null, errors: errors ?? undefined, payment: receiptSummary(result) });
    } catch (e) {
      return fail(e);
    }
  },
);

// 4) Schema (paid) ---------------------------------------------------------
server.registerTool(
  "get_subgraph_schema",
  {
    title: "Get subgraph schema (paid)",
    description:
      "List a subgraph's root queryable entities via GraphQL introspection (a paid x402 query). Use to learn what's queryable before composing a real query.",
    inputSchema: { subgraph_id: z.string().describe("Subgraph ID") },
  },
  async ({ subgraph_id }) => {
    try {
      const { entities, result } = await introspectSchema(engine, cfg, subgraph_id);
      if (result.needsHarnessPayment) {
        return ok({ ok: true, needsHarnessPayment: true, quote: result.quote });
      }
      return ok({ ok: true, queryableEntities: entities, payment: receiptSummary(result) });
    } catch (e) {
      return fail(e);
    }
  },
);

// 5) Wallet status ---------------------------------------------------------
server.registerTool(
  "wallet_status",
  {
    title: "Wallet & payment status",
    description:
      "Report the payment mode, wallet address, USDC/ETH balance on Base, the per-query spend cap and funding instructions. Never reveals the private key.",
    inputSchema: {},
  },
  async () => {
    try {
      const usdc = await engine.usdcBalance().catch(() => undefined);
      const eth = await engine.ethBalance().catch(() => undefined);
      return ok({
        ok: true,
        paymentMode: cfg.paymentMode,
        walletProvider: cfg.walletProvider ?? (engine.canPay ? "byo" : "harness"),
        network: cfg.network,
        address: engine.address ?? null,
        canPay: engine.canPay,
        usdcBalance: usdc !== undefined ? Number(formatUnits(usdc, 6)).toFixed(6) : null,
        ethBalanceInfo: eth !== undefined ? Number(formatUnits(eth, 18)).toFixed(6) : null,
        gaslessPayments: true,
        maxUsdPerQuery: cfg.maxUsdPerQuery,
        funding: fundingGuidance(engine.address, cfg),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for JSON-RPC; everything human-facing goes to stderr.
  console.error(
    `payql ready - network=${cfg.network} mode=${cfg.paymentMode} cap=$${cfg.maxUsdPerQuery}/query` +
      (engine.address ? ` wallet=${engine.address}` : " (no wallet: quote-only/harness-pays)"),
  );
}

main().catch((e) => {
  console.error("payql fatal:", e);
  process.exit(1);
});
