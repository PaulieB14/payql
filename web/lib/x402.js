// Minimal x402 query engine for the playground — the same flow PayQL uses:
// preflight the 402 for a price, then pay (gasless EIP-3009) and run the query.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";

const GATEWAY = process.env.PAYQL_GATEWAY_BASE || "https://gateway.thegraph.com/api/x402";
const USDC = (process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
const CAIP2 = "eip155:8453";

export function gatewayUrl(subgraphId) {
  return `${GATEWAY}/subgraphs/id/${subgraphId}`;
}
function gqlInit(query) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables: {} }) };
}
const amountOf = (a) => String(a?.amount ?? a?.maxAmountRequired ?? "0");
function networkMatches(n) {
  n = (n || "").toLowerCase();
  return n === CAIP2 || n === "eip155:8453" || n === "base" || n === "8453";
}
function pickAccept(accepts) {
  if (!Array.isArray(accepts) || !accepts.length) return undefined;
  const exact = accepts.filter((a) => (a?.scheme || "").toLowerCase() === "exact");
  const pool = exact.length ? exact : accepts;
  const onNet = pool.filter((a) => networkMatches(a?.network));
  const cand = onNet.length ? onNet : pool;
  const usdc = cand.filter((a) => (a?.asset || "").toLowerCase() === USDC);
  const fin = usdc.length ? usdc : cand;
  return [...fin].sort((a, b) => Number(amountOf(a)) - Number(amountOf(b)))[0];
}
// The Graph gateway delivers the 402 challenge in a base64 `payment-required` header.
async function paymentRequiredFrom(res) {
  const h = res.headers.get("payment-required") ?? res.headers.get("x-payment-required");
  if (h) {
    try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch {}
    try { return JSON.parse(h); } catch {}
  }
  return res.json().catch(() => ({}));
}
function decodeReceipt(header) {
  if (!header) return undefined;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { success: j.success !== false, txHash: j.transaction ?? j.txHash, network: j.network, amount: j.amount };
  } catch { return undefined; }
}

let _payFetch;
function payFetch() {
  if (_payFetch) return _payFetch;
  let pk = (process.env.DEMO_PRIVATE_KEY || "").trim();
  if (pk && !pk.startsWith("0x")) pk = "0x" + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("DEMO_PRIVATE_KEY missing or invalid — set a funded Base wallet key (USDC only).");
  }
  const account = privateKeyToAccount(pk);
  const client = new x402Client().register(CAIP2, new ExactEvmScheme(account));
  _payFetch = wrapFetchWithPayment(globalThis.fetch, client);
  return _payFetch;
}

/** Preflight: read the gateway's price from the 402 challenge — no payment. */
export async function quote(subgraphId, query) {
  const res = await fetch(gatewayUrl(subgraphId), gqlInit(query));
  if (res.status !== 402) return null;
  const pr = await paymentRequiredFrom(res);
  const e = pickAccept(pr?.accepts || []);
  if (!e) return null;
  return {
    priceUsd: Number(formatUnits(BigInt(amountOf(e)), 6)),
    payTo: e.payTo,
    network: e.network,
    asset: e.asset,
    scheme: e.scheme,
  };
}

/** Pay the 402 (gasless) and run the query. Returns data + receipt (tx hash). */
export async function runPaid(subgraphId, query) {
  const res = await payFetch()(gatewayUrl(subgraphId), gqlInit(query));
  const receipt = decodeReceipt(res.headers.get("x-payment-response") ?? res.headers.get("payment-response"));
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  return { data: body?.data ?? null, errors: body?.errors, receipt };
}
