import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../dist/config.js";
import { pickAccept, paymentRequiredFrom, decodeReceiptHeader } from "../dist/x402.js";
import { toFulltext, weiToGRT, subgraphUrl, gqlInit } from "../dist/graph.js";

const KEY = "0x" + "1".repeat(64);
const ADDR = "0x" + "a".repeat(40);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

// ---------------------------------------------------------------- config ----
test("config: defaults to harness, $0.01 cap, base mainnet", () => {
  const c = loadConfig({});
  assert.equal(c.network, "base");
  assert.equal(c.chainId, 8453);
  assert.equal(c.caip2, "eip155:8453");
  assert.equal(c.paymentMode, "harness");
  assert.equal(c.maxUsdPerQuery, 0.01);
  assert.equal(c.ampersend, false);
});

test("config: PAYQL_PRIVATE_KEY → wallet mode", () => {
  const c = loadConfig({ PAYQL_PRIVATE_KEY: KEY });
  assert.equal(c.paymentMode, "wallet");
  assert.equal(c.privateKey, KEY);
});

test("config: X402_PRIVATE_KEY fallback works", () => {
  const c = loadConfig({ X402_PRIVATE_KEY: "0x" + "2".repeat(64) });
  assert.equal(c.paymentMode, "wallet");
  assert.equal(c.privateKey, "0x" + "2".repeat(64));
});

test("config: key without 0x prefix is normalized", () => {
  const c = loadConfig({ PAYQL_PRIVATE_KEY: "1".repeat(64) });
  assert.equal(c.privateKey, KEY);
});

test("config: invalid private key throws", () => {
  assert.throws(() => loadConfig({ PAYQL_PRIVATE_KEY: "0xnothex" }), /private key/i);
});

test("config: invalid network throws", () => {
  assert.throws(() => loadConfig({ PAYQL_NETWORK: "ethereum" }), /base/);
});

test("config: invalid payment mode throws", () => {
  assert.throws(() => loadConfig({ PAYQL_PAYMENT_MODE: "freeloader" }), /wallet/);
});

test("config: non-numeric cap throws", () => {
  assert.throws(() => loadConfig({ PAYQL_MAX_USD_PER_QUERY: "abc" }), /positive number/);
});

test("config: cap override parses", () => {
  const c = loadConfig({ PAYQL_PRIVATE_KEY: KEY, PAYQL_MAX_USD_PER_QUERY: "0.5" });
  assert.equal(c.maxUsdPerQuery, 0.5);
});

test("config: base-sepolia switches chain + USDC + gateway", () => {
  const c = loadConfig({ PAYQL_NETWORK: "base-sepolia" });
  assert.equal(c.chainId, 84532);
  assert.equal(c.caip2, "eip155:84532");
  assert.match(c.gatewayBase, /testnet\.gateway\.thegraph\.com/);
  assert.equal(c.usdc.toLowerCase(), "0x036cbd53842c5426634e7929541ec2318f3dcf7e");
});

test("config: wallet mode with no key degrades to harness", () => {
  const c = loadConfig({ PAYQL_PAYMENT_MODE: "wallet" });
  assert.equal(c.paymentMode, "harness");
});

test("config: ampersend mode with creds", () => {
  const c = loadConfig({
    PAYQL_PAYMENT_MODE: "managed",
    PAYQL_WALLET_PROVIDER: "ampersend",
    PAYQL_AMPERSEND_SMART_ACCOUNT: ADDR,
    PAYQL_AMPERSEND_SESSION_KEY: KEY,
  });
  assert.equal(c.paymentMode, "managed");
  assert.equal(c.ampersend, true);
  assert.equal(c.ampersendSmartAccount, ADDR);
  assert.equal(c.ampersendSessionKey, KEY);
});

test("config: ampersend accepts AMPERSEND_AGENT_* fallback env", () => {
  const c = loadConfig({
    PAYQL_PAYMENT_MODE: "managed",
    PAYQL_WALLET_PROVIDER: "ampersend",
    AMPERSEND_AGENT_ACCOUNT: ADDR,
    AMPERSEND_AGENT_KEY: KEY,
  });
  assert.equal(c.ampersend, true);
  assert.equal(c.ampersendSmartAccount, ADDR);
});

test("config: ampersend mode without creds degrades to harness", () => {
  const c = loadConfig({ PAYQL_PAYMENT_MODE: "managed", PAYQL_WALLET_PROVIDER: "ampersend" });
  assert.equal(c.paymentMode, "harness");
  assert.equal(c.ampersend, false);
});

test("config: managed without ampersend provider needs a key", () => {
  const c = loadConfig({ PAYQL_PAYMENT_MODE: "managed", PAYQL_PRIVATE_KEY: KEY });
  assert.equal(c.paymentMode, "managed");
  assert.equal(c.ampersend, false);
});

test("config: registry URL + network subgraph override", () => {
  const c = loadConfig({ PAYQL_REGISTRY_URL: "https://reg.example/gql", PAYQL_NETWORK_SUBGRAPH_ID: "XYZ" });
  assert.equal(c.registryUrl, "https://reg.example/gql");
  assert.equal(c.networkSubgraphId, "XYZ");
});

// ----------------------------------------------------------- pickAccept ----
const cfg = loadConfig({});

test("pickAccept: selects exact USDC on base", () => {
  const e = pickAccept([{ scheme: "exact", network: "eip155:8453", asset: cfg.usdc, amount: "10000", payTo: "0x1" }], cfg);
  assert.equal(e.amount, "10000");
});

test("pickAccept: tolerates 'base' network alias", () => {
  const e = pickAccept([{ scheme: "exact", network: "base", asset: cfg.usdc, amount: "10000" }], cfg);
  assert.ok(e);
});

test("pickAccept: picks cheapest of several", () => {
  const e = pickAccept(
    [
      { scheme: "exact", network: "eip155:8453", asset: cfg.usdc, amount: "20000" },
      { scheme: "exact", network: "eip155:8453", asset: cfg.usdc, amount: "5000" },
    ],
    cfg,
  );
  assert.equal(e.amount, "5000");
});

test("pickAccept: prefers exact over other schemes", () => {
  const e = pickAccept(
    [
      { scheme: "upto", network: "eip155:8453", asset: cfg.usdc, amount: "1" },
      { scheme: "exact", network: "eip155:8453", asset: cfg.usdc, amount: "10000" },
    ],
    cfg,
  );
  assert.equal(e.scheme, "exact");
});

test("pickAccept: supports v1 maxAmountRequired field", () => {
  const e = pickAccept([{ scheme: "exact", network: "base", asset: cfg.usdc, maxAmountRequired: "10000" }], cfg);
  assert.ok(e);
  assert.equal(e.maxAmountRequired, "10000");
});

test("pickAccept: empty list → undefined", () => {
  assert.equal(pickAccept([], cfg), undefined);
  assert.equal(pickAccept(null, cfg), undefined);
});

test("pickAccept: sepolia chain id matches base-sepolia config", () => {
  const sep = loadConfig({ PAYQL_NETWORK: "base-sepolia" });
  const e = pickAccept([{ scheme: "exact", network: "eip155:84532", asset: sep.usdc, amount: "10000" }], sep);
  assert.ok(e);
});

// ------------------------------------------------ paymentRequiredFrom ----
test("paymentRequiredFrom: decodes base64 payment-required header", async () => {
  const res = new Response("", { status: 402, headers: { "payment-required": b64({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000" }] }) } });
  const pr = await paymentRequiredFrom(res);
  assert.equal(pr.accepts[0].amount, "10000");
});

test("paymentRequiredFrom: decodes raw-JSON header", async () => {
  const res = new Response("", { status: 402, headers: { "payment-required": JSON.stringify({ accepts: [{ amount: "7000" }] }) } });
  const pr = await paymentRequiredFrom(res);
  assert.equal(pr.accepts[0].amount, "7000");
});

test("paymentRequiredFrom: falls back to JSON body", async () => {
  const res = new Response(JSON.stringify({ x402Version: 2, accepts: [{ amount: "5000" }] }), { status: 402, headers: { "content-type": "application/json" } });
  const pr = await paymentRequiredFrom(res);
  assert.equal(pr.accepts[0].amount, "5000");
});

// ------------------------------------------------- decodeReceiptHeader ----
test("decodeReceiptHeader: parses a successful settle", () => {
  const r = decodeReceiptHeader(b64({ success: true, transaction: "0xdead", network: "eip155:8453", amount: "10000" }), 0.01);
  assert.equal(r.success, true);
  assert.equal(r.txHash, "0xdead");
  assert.equal(r.amountUsd, 0.01);
});

test("decodeReceiptHeader: surfaces failed settle reason", () => {
  const r = decodeReceiptHeader(b64({ success: false, errorReason: "insufficient_funds" }), 0.01);
  assert.equal(r.success, false);
  assert.equal(r.errorReason, "insufficient_funds");
});

test("decodeReceiptHeader: null/garbage → undefined", () => {
  assert.equal(decodeReceiptHeader(null, 0.01), undefined);
  assert.equal(decodeReceiptHeader("%%%not-json%%%", 0.01), undefined);
});

// -------------------------------------------------------- graph helpers ----
test("toFulltext: multi-word → prefix AND", () => {
  assert.equal(toFulltext("uniswap v3"), "uniswap:* & v3:*");
});

test("toFulltext: strips punctuation", () => {
  assert.equal(toFulltext("a&b! c"), "a:* & b:* & c:*");
});

test("toFulltext: single token", () => {
  assert.equal(toFulltext("ENS"), "ens:*");
});

test("weiToGRT: converts and handles null", () => {
  assert.equal(weiToGRT("1000000000000000000"), 1);
  assert.equal(weiToGRT("500000000000000000"), 0.5);
  assert.equal(weiToGRT(null), null);
  assert.equal(weiToGRT(undefined), null);
});

test("subgraphUrl: builds the x402 gateway path", () => {
  assert.equal(subgraphUrl(cfg, "ABC"), "https://gateway.thegraph.com/api/x402/subgraphs/id/ABC");
});

test("gqlInit: POST with json body + variables", () => {
  const i = gqlInit("{ x }", { a: 1 });
  assert.equal(i.method, "POST");
  assert.equal(i.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(i.body), { query: "{ x }", variables: { a: 1 } });
});

test("gqlInit: defaults variables to {}", () => {
  const i = gqlInit("{ x }");
  assert.deepEqual(JSON.parse(i.body).variables, {});
});
