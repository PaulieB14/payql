import type { Address } from "viem";

export type Network = "base" | "base-sepolia";
export type PaymentMode = "wallet" | "harness" | "managed";

export interface Config {
  network: Network;
  chainId: number;
  caip2: `${string}:${string}`;
  gatewayBase: string;
  usdc: Address;
  rpcUrl: string;
  paymentMode: PaymentMode;
  privateKey?: `0x${string}`;
  maxUsdPerQuery: number;
  registryUrl?: string;
  networkSubgraphId: string;
  walletProvider?: string;
}

interface NetParams {
  chainId: number;
  caip2: `${string}:${string}`;
  gatewayBase: string;
  usdc: Address;
  rpcUrl: string;
}

const NETWORKS: Record<Network, NetParams> = {
  base: {
    chainId: 8453,
    caip2: "eip155:8453",
    gatewayBase: "https://gateway.thegraph.com/api/x402",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpcUrl: "https://mainnet.base.org",
  },
  "base-sepolia": {
    chainId: 84532,
    caip2: "eip155:84532",
    gatewayBase: "https://testnet.gateway.thegraph.com/api/x402",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpcUrl: "https://sepolia.base.org",
  },
};

// The Graph Network (Arbitrum) metadata subgraph — indexes every subgraph,
// version and deployment. Used for keyword discovery + popularity ranking.
const DEFAULT_NETWORK_SUBGRAPH = "DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp";

function normalizePrivateKey(v: string | undefined): `0x${string}` | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  const withPrefix = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("PAYQL_PRIVATE_KEY is set but is not a valid 32-byte hex private key.");
  }
  return withPrefix as `0x${string}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const network = (env.PAYQL_NETWORK?.trim() as Network) || "base";
  if (!NETWORKS[network]) {
    throw new Error(`PAYQL_NETWORK must be "base" or "base-sepolia" (got "${network}").`);
  }
  const net = NETWORKS[network];

  const privateKey = normalizePrivateKey(env.PAYQL_PRIVATE_KEY ?? env.X402_PRIVATE_KEY);

  let paymentMode = (env.PAYQL_PAYMENT_MODE?.trim() as PaymentMode) || (privateKey ? "wallet" : "harness");
  if (!["wallet", "harness", "managed"].includes(paymentMode)) {
    throw new Error(`PAYQL_PAYMENT_MODE must be "wallet", "harness" or "managed" (got "${paymentMode}").`);
  }
  // A paying mode without a key can't sign — degrade to harness so the server
  // still boots and can quote prices / hand 402s to a wallet-equipped harness.
  if ((paymentMode === "wallet" || paymentMode === "managed") && !privateKey) {
    paymentMode = "harness";
  }

  const maxUsdPerQuery = env.PAYQL_MAX_USD_PER_QUERY ? Number(env.PAYQL_MAX_USD_PER_QUERY) : 0.1;
  if (!Number.isFinite(maxUsdPerQuery) || maxUsdPerQuery <= 0) {
    throw new Error("PAYQL_MAX_USD_PER_QUERY must be a positive number (USD).");
  }

  return {
    network,
    chainId: net.chainId,
    caip2: net.caip2,
    gatewayBase: env.PAYQL_GATEWAY_BASE?.trim() || net.gatewayBase,
    usdc: (env.PAYQL_USDC_ADDRESS?.trim() as Address) || net.usdc,
    rpcUrl: env.PAYQL_RPC_URL?.trim() || net.rpcUrl,
    paymentMode,
    privateKey,
    maxUsdPerQuery,
    registryUrl: env.PAYQL_REGISTRY_URL?.trim() || undefined,
    networkSubgraphId: env.PAYQL_NETWORK_SUBGRAPH_ID?.trim() || DEFAULT_NETWORK_SUBGRAPH,
    walletProvider: env.PAYQL_WALLET_PROVIDER?.trim() || undefined,
  };
}
