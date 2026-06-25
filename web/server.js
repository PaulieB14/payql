import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { EXAMPLES } from "./lib/examples.js";
import { quote, gatewayUrl } from "./lib/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1); // behind Railway's proxy — so req.ip is the real client
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/api/examples", (_req, res) => {
  res.json(EXAMPLES.map(({ id, label, protocol }) => ({ id, label, protocol })));
});

// Free preview: the subgraph + ready-to-run query + the LIVE price (read from
// the gateway's unpaid 402 — costs nothing). No results here. Results are only
// fetched client-side when the user pays with their own wallet.
app.post("/api/preview", async (req, res) => {
  try {
    const ex = EXAMPLES.find((e) => e.id === (req.body || {}).exampleId);
    if (!ex) return res.status(400).json({ error: "unknown example" });
    let q = null;
    try { q = await quote(ex.subgraphId, ex.query); } catch { /* still return the rest */ }
    res.json({
      protocol: ex.protocol,
      subgraphId: ex.subgraphId,
      query: ex.query,
      gatewayUrl: gatewayUrl(ex.subgraphId),
      priceUsd: q ? q.priceUsd : 0.01,
      payTo: q ? q.payTo : undefined,
      network: q ? q.network : "eip155:8453",
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// ---- Free-text "ask anything" router ----------------------------------------
// Reuses GA's Anthropic key on Haiku (a fraction of a cent per question). Maps
// any free-typed question to ONE of our validated subgraphs + a GraphQL query.
// The query is shown for FREE; the user pays the $0.01 to run it with their own
// wallet (same as the curated chips). Routing is on us; we never pay the query.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const CATALOG = EXAMPLES.map(
  (e, i) =>
    `${i + 1}. id=${e.subgraphId}  [${e.protocol}] — ${e.label}\n   known-good query: ${e.query.replace(/\s+/g, " ").trim()}`,
).join("\n");

const ROUTER_SYSTEM = `You route a user's question about on-chain / DeFi / The Graph data to ONE subgraph below and return a GraphQL query that answers it.

SUBGRAPHS (each has a known-good query you can trust):
${CATALOG}

RULES:
- Pick the subgraphId that best fits the question.
- Return a GraphQL query that answers it. Start from that subgraph's known-good query; you may change the count (first, keep <= 10), orderBy / orderDirection, and add simple where filters — but ONLY using fields that already appear in that subgraph's known-good query. Never invent fields.
- "label" = a short restatement of what the query returns.
- "note" = "" if the chosen subgraph fits the question well. Only if you had to pick a non-ideal subgraph (the question is outside what these subgraphs cover), put one short sentence there explaining the limitation.`;

const ROUTE_TOOL = {
  name: "route",
  description: "Return the chosen subgraph and a GraphQL query that answers the question.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      subgraphId: { type: "string", enum: EXAMPLES.map((e) => e.subgraphId) },
      protocol: { type: "string" },
      query: { type: "string" },
      label: { type: "string" },
      note: { type: "string" },
    },
    required: ["subgraphId", "protocol", "query", "label", "note"],
    additionalProperties: false,
  },
};

// Tiny per-IP throttle so the free-text box can't be run up by a bot.
const RL = new Map();
function rateLimited(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const arr = (RL.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  RL.set(ip, arr);
  return arr.length > max;
}

app.post("/api/ask", async (req, res) => {
  const question = String((req.body || {}).question || "").trim().slice(0, 400);
  if (!question) return res.status(400).json({ error: "Ask a question first." });
  if (!anthropic)
    return res.status(503).json({
      error: "Free-text questions aren't enabled on this server yet — tap one of the examples below (those work without it).",
    });
  if (rateLimited(req.ip))
    return res.status(429).json({ error: "Whoa — too many questions in a minute. Give it a moment." });
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: ROUTER_SYSTEM,
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: "route" },
      messages: [{ role: "user", content: question }],
    });
    const tu = msg.content.find((b) => b.type === "tool_use");
    if (!tu) return res.status(502).json({ error: "Couldn't route that one — try rephrasing, or tap an example." });
    const r = tu.input;
    let q = null;
    try { q = await quote(r.subgraphId, r.query); } catch { /* still return the query */ }
    res.json({
      protocol: r.protocol,
      subgraphId: r.subgraphId,
      query: r.query,
      label: r.label,
      note: r.note || undefined,
      gatewayUrl: gatewayUrl(r.subgraphId),
      priceUsd: q ? q.priceUsd : 0.01,
      payTo: q ? q.payTo : undefined,
      network: q ? q.network : "eip155:8453",
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Same-origin proxy to The Graph's x402 gateway. The gateway returns the x402
// challenge in a `PAYMENT-REQUIRED` response header but does NOT expose it via CORS
// (`Access-Control-Expose-Headers`), so a browser can't read it cross-origin and the
// @x402 client fails with "Invalid payment required response". Proxying same-origin
// makes the header readable. The user's wallet still signs the payment — we only
// relay the signed `X-PAYMENT` to the gateway (non-custodial; no key here).
app.post("/api/gw/:subgraphId", async (req, res) => {
  try {
    const url = `https://gateway.thegraph.com/api/x402/subgraphs/id/${req.params.subgraphId}`;
    const headers = { "content-type": "application/json" };
    for (const h of ["x-payment", "payment-signature"]) {
      const v = req.get(h);
      if (v) headers[h] = v;
    }
    const upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(req.body || {}) });
    for (const h of ["payment-required", "payment-response", "x-payment-response"]) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.error(`PayQL Playground on :${PORT}`));
