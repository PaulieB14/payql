import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { EXAMPLES } from "./lib/examples.js";
import { quote, runPaid, gatewayUrl } from "./lib/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Global cap so the demo wallet can't be drained by abuse.
const MAX = Number(process.env.DEMO_MAX_QUERIES || 200);
let count = 0;

app.get("/api/examples", (_req, res) => {
  res.json(EXAMPLES.map(({ id, label, protocol, subgraphId, query }) => ({ id, label, protocol, subgraphId, query })));
});

app.post("/api/query", async (req, res) => {
  try {
    const ex = EXAMPLES.find((e) => e.id === (req.body || {}).exampleId);
    if (!ex) return res.status(400).json({ error: "unknown example" });
    if (!process.env.DEMO_PRIVATE_KEY) {
      return res.status(503).json({ error: "The demo wallet isn't funded right now — switch to ‘Pay with your wallet’." });
    }
    if (count >= MAX) {
      return res.status(429).json({ error: "Demo query limit reached for now. Run PayQL with your own wallet to keep going: npx -y payql" });
    }

    const steps = [];
    steps.push({ step: "discover", text: `${ex.protocol} subgraph`, subgraphId: ex.subgraphId, url: gatewayUrl(ex.subgraphId) });

    const q = await quote(ex.subgraphId, ex.query);
    if (!q) return res.status(502).json({ error: "Gateway did not return a 402 (endpoint may have changed)." });
    steps.push({ step: "402", text: `Gateway requires payment: $${q.priceUsd.toFixed(2)} USDC on Base`, priceUsd: q.priceUsd, payTo: q.payTo, network: q.network, scheme: q.scheme });

    count++;
    const r = await runPaid(ex.subgraphId, ex.query);
    steps.push({
      step: "paid",
      text: `Paid $${q.priceUsd.toFixed(2)} USDC — gasless (EIP-3009)`,
      txHash: r.receipt?.txHash || null,
      basescan: r.receipt?.txHash ? `https://basescan.org/tx/${r.receipt.txHash}` : null,
    });

    res.json({ ok: !r.errors, protocol: ex.protocol, query: ex.query, steps, data: r.data, errors: r.errors });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.error(`PayQL Playground on :${PORT}`));
