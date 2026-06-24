import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { EXAMPLES } from "./lib/examples.js";
import { quote, gatewayUrl } from "./lib/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.error(`PayQL Playground on :${PORT}`));
