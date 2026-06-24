import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, erc20Abi, formatUnits, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Config } from "./config.js";
import { fundingGuidance } from "./wallet.js";
import { buildAmpersendClient } from "./ampersend.js";

export interface Quote {
  amountAtomic: string;
  amountUsd: number;
  asset: string;
  payTo: string;
  network: string;
  scheme: string;
}

export interface Receipt {
  success: boolean;
  txHash?: string;
  network?: string;
  amountUsd?: number;
  payer?: string;
  errorReason?: string;
}

export interface PaidResult {
  /** Full GraphQL HTTP body, i.e. `{ data, errors }` (null in harness mode). */
  data: any;
  paid: boolean;
  status: number;
  quote?: Quote;
  receipt?: Receipt;
  needsHarnessPayment?: boolean;
}

export class SpendCapError extends Error {
  constructor(public usd: number, public cap: number) {
    super(
      `Query price $${usd.toFixed(4)} exceeds your per-query cap of $${cap.toFixed(4)} ` +
        `(PAYQL_MAX_USD_PER_QUERY). Raise the cap to proceed.`,
    );
    this.name = "SpendCapError";
  }
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientFundsError";
  }
}

function chainFor(cfg: Config) {
  return cfg.network === "base" ? base : baseSepolia;
}

// Tolerate "base" vs "eip155:8453" advertising differences across facilitators.
function networkMatches(entryNet: string | undefined, cfg: Config): boolean {
  if (!entryNet) return false;
  const n = entryNet.toLowerCase();
  if (n === cfg.caip2 || n === `eip155:${cfg.chainId}` || n === String(cfg.chainId)) return true;
  if (cfg.network === "base") return n === "base" || n === "base-mainnet";
  return n === "base-sepolia" || n === "basesepolia";
}

function amountOf(a: any): string {
  return String(a?.amount ?? a?.maxAmountRequired ?? "0");
}

/** Choose the cheapest `exact`/USDC payment option on our network from a 402. */
export function pickAccept(accepts: any[], cfg: Config): any | undefined {
  if (!Array.isArray(accepts) || accepts.length === 0) return undefined;
  const exact = accepts.filter((a) => (a?.scheme ?? "").toLowerCase() === "exact");
  const pool = exact.length ? exact : accepts;
  const onNet = pool.filter((a) => networkMatches(a?.network, cfg));
  const candidates = onNet.length ? onNet : pool;
  const usdc = candidates.filter((a) => (a?.asset ?? "").toLowerCase() === cfg.usdc.toLowerCase());
  const finalPool = usdc.length ? usdc : candidates;
  return [...finalPool].sort((a, b) => Number(amountOf(a)) - Number(amountOf(b)))[0];
}

// The Graph's gateway delivers the x402 challenge as a base64-JSON
// `payment-required` response header; the x402 spec also allows it in the JSON
// body. Read the header first, then fall back to the body.
async function paymentRequiredFrom(res: Response): Promise<any> {
  const h = res.headers.get("payment-required") ?? res.headers.get("x-payment-required");
  if (h) {
    try {
      return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    } catch {
      /* not base64 */
    }
    try {
      return JSON.parse(h);
    } catch {
      /* not raw json */
    }
  }
  return res.json().catch(() => ({}));
}

// The x402 settlement receipt rides back base64-encoded in X-PAYMENT-RESPONSE.
function decodeReceiptHeader(header: string | null, fallbackUsd: number): Receipt | undefined {
  if (!header) return undefined;
  try {
    const json = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return {
      success: json.success !== false,
      txHash: json.transaction ?? json.txHash,
      network: json.network,
      payer: json.payer,
      errorReason: json.errorReason,
      amountUsd: json.amount ? Number(formatUnits(BigInt(json.amount), 6)) : fallbackUsd,
    };
  } catch {
    return undefined;
  }
}

export class PaymentEngine {
  readonly cfg: Config;
  private account?: ReturnType<typeof privateKeyToAccount>;
  private addressOverride?: Address;
  private payFetch?: (input: any, init?: any) => Promise<Response>;
  private ampersendInit?: Promise<void>;
  // `any` sidesteps viem's chain-specific (OP-stack) PublicClient generics;
  // we only call readContract / getBalance, which are universally present.
  private pub: any;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.pub = createPublicClient({ chain: chainFor(cfg), transport: http(cfg.rpcUrl) });
    if (cfg.paymentMode === "harness") return;
    if (cfg.ampersend) {
      // Managed (Ampersend) wallet: address is known up front; the paying client
      // is built lazily on first paid call (dynamic import of the optional SDK).
      this.addressOverride = cfg.ampersendSmartAccount;
    } else if (cfg.privateKey) {
      this.account = privateKeyToAccount(cfg.privateKey);
      // x402 v2: signer goes into the `exact` EVM scheme registered on the client.
      // The account only ever signs an EIP-712 authorization off-chain; the
      // facilitator submits the tx and pays gas (gasless for us).
      const client = new x402Client().register(cfg.caip2, new ExactEvmScheme(this.account));
      this.payFetch = wrapFetchWithPayment(globalThis.fetch as any, client as any) as any;
    }
  }

  /** Lazily build the Ampersend paying client on first paid call (no-op for BYO/harness). */
  private async ensurePayFetch(): Promise<void> {
    if (this.payFetch || this.cfg.paymentMode === "harness" || !this.cfg.ampersend) return;
    if (!this.ampersendInit) {
      this.ampersendInit = (async () => {
        const client = await buildAmpersendClient(this.cfg);
        this.payFetch = wrapFetchWithPayment(globalThis.fetch as any, client as any) as any;
      })();
    }
    await this.ampersendInit;
  }

  get address(): Address | undefined {
    return this.account?.address ?? this.addressOverride;
  }
  get canPay(): boolean {
    if (this.cfg.paymentMode === "harness") return false;
    if (this.cfg.ampersend) return !!(this.cfg.ampersendSmartAccount && this.cfg.ampersendSessionKey);
    return !!this.payFetch;
  }

  async usdcBalance(): Promise<bigint | undefined> {
    const addr = this.address;
    if (!addr) return undefined;
    return (await this.pub.readContract({
      address: this.cfg.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;
  }

  async ethBalance(): Promise<bigint | undefined> {
    const addr = this.address;
    if (!addr) return undefined;
    return this.pub.getBalance({ address: addr });
  }

  /** Preflight: price a request via its 402 challenge without paying. Returns
   *  null if the endpoint did not respond with 402 (free, or wrong id). */
  async quote(url: string, init: RequestInit): Promise<Quote | null> {
    const res = await fetch(url, init);
    if (res.status !== 402) return null;
    const pr = await paymentRequiredFrom(res);
    const entry = pickAccept(pr?.accepts ?? [], this.cfg);
    if (!entry) {
      throw new Error(`Endpoint returned 402 but no compatible payment option (exact/USDC on ${this.cfg.network}).`);
    }
    const atomic = amountOf(entry);
    return {
      amountAtomic: atomic,
      amountUsd: Number(formatUnits(BigInt(atomic), 6)),
      asset: entry.asset,
      payTo: entry.payTo,
      network: entry.network,
      scheme: entry.scheme,
    };
  }

  /**
   * Execute a request, paying via x402 if the endpoint challenges with 402.
   * Flow: probe (unpaid) -> read quote -> enforce spend cap -> in harness mode
   * return the quote -> balance preflight -> sign + pay + retry -> receipt.
   */
  async paidFetch(url: string, init: RequestInit): Promise<PaidResult> {
    // Probe unpaid: handles free queries, surfaces the quote, and lets us
    // enforce the cap before any signature is produced.
    const probe = await fetch(url, init);
    if (probe.status !== 402) {
      const data = await probe.json().catch(() => null);
      if (!probe.ok) {
        throw new Error(`Request failed: HTTP ${probe.status}${data ? " " + JSON.stringify(data).slice(0, 300) : ""}`);
      }
      return { data, paid: false, status: probe.status };
    }

    const pr = await paymentRequiredFrom(probe);
    const entry = pickAccept(pr?.accepts ?? [], this.cfg);
    if (!entry) {
      throw new Error(`Endpoint returned 402 but no compatible payment option (exact/USDC on ${this.cfg.network}).`);
    }
    const atomic = BigInt(amountOf(entry));
    const usd = Number(formatUnits(atomic, 6));
    const quote: Quote = {
      amountAtomic: atomic.toString(),
      amountUsd: usd,
      asset: entry.asset,
      payTo: entry.payTo,
      network: entry.network,
      scheme: entry.scheme,
    };

    if (usd > this.cfg.maxUsdPerQuery) throw new SpendCapError(usd, this.cfg.maxUsdPerQuery);

    // Build the Ampersend client on demand (no-op for BYO/harness).
    await this.ensurePayFetch();

    if (!this.payFetch) {
      // Harness-pays mode: hand the quote back for a wallet-equipped harness.
      return { data: null, paid: false, status: 402, quote, needsHarnessPayment: true };
    }

    // BYO: preflight balance so we fail with a fund-wallet message, not a revert.
    // Ampersend manages funding + limits itself, so skip the local balance gate.
    if (!this.cfg.ampersend) {
      const bal = await this.usdcBalance().catch(() => undefined);
      if (bal !== undefined && bal < atomic) {
        throw new InsufficientFundsError(
          `Need ${usd.toFixed(4)} USDC for this query but the wallet holds ${Number(formatUnits(bal, 6)).toFixed(4)} USDC.\n\n` +
            fundingGuidance(this.address, this.cfg),
        );
      }
    }

    let res: Response;
    try {
      res = await this.payFetch(url, init);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (this.cfg.ampersend && /declin|policy|limit|unauthor|insufficient/i.test(m)) {
        throw new Error(
          `Ampersend declined this payment (spend policy or balance — check your Ampersend dashboard): ${m}`,
        );
      }
      throw e;
    }
    const receipt = decodeReceiptHeader(
      res.headers.get("x-payment-response") ?? res.headers.get("payment-response"),
      usd,
    );
    if (receipt && receipt.success === false) {
      if (receipt.errorReason === "insufficient_funds") {
        throw new InsufficientFundsError(
          `Payment settlement failed: insufficient USDC.\n\n${fundingGuidance(this.address, this.cfg)}`,
        );
      }
      throw new Error(`Payment settlement failed: ${receipt.errorReason ?? "unknown reason"}.`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Paid request failed: HTTP ${res.status}${data ? " " + JSON.stringify(data).slice(0, 300) : ""}`);
    }
    return { data, paid: true, status: res.status, quote, receipt };
  }
}
