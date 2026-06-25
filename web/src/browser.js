// Browser BYO-wallet x402: connect an injected wallet and pay per query with the
// user's own funds. Each payment is a single EIP-3009 signature for an EXACT
// $0.01 — never a token approval / allowance, so the site can't drain anything.
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

// Same-origin proxy (server forwards to The Graph's x402 gateway). Direct cross-origin
// calls fail because the gateway doesn't CORS-expose the PAYMENT-REQUIRED challenge
// header, so the browser can't read it. The proxy relays it; the wallet still signs.
const GATEWAY = "/api/gw/";
const CAIP2 = "eip155:8453";
const BASE_HEX = "0x2105"; // 8453

let state = { address: null, payFetch: null };

export function connectedAddress() {
  return state.address;
}

export async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet detected. Install MetaMask or a Base-compatible wallet.");
  const [address] = await eth.request({ method: "eth_requestAccounts" });
  // Make sure we're on Base.
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_HEX }] });
  } catch (e) {
    if (e && e.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_HEX,
          chainName: "Base",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
    }
  }
  const walletClient = createWalletClient({ account: address, chain: base, transport: custom(eth) });
  // @x402 calls signer.signTypedData({ domain, types, primaryType, message }) — viem's exact shape.
  const signer = {
    address,
    signTypedData: (params) => walletClient.signTypedData({ account: address, ...params }),
  };
  const client = new x402Client().register(CAIP2, new ExactEvmScheme(signer));
  state = { address, payFetch: wrapFetchWithPayment(window.fetch.bind(window), client) };
  return address;
}

export async function payQuery(subgraphId, query) {
  if (!state.payFetch) throw new Error("Connect your wallet first.");
  const res = await state.payFetch(GATEWAY + subgraphId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: {} }),
  });
  let receipt;
  const h = res.headers.get("x-payment-response") || res.headers.get("payment-response");
  if (h) { try { receipt = JSON.parse(atob(h)); } catch {} }
  const body = await res.json().catch(() => null);
  return {
    ok: !(body && body.errors),
    data: body && body.data,
    errors: body && body.errors,
    txHash: receipt && (receipt.transaction || receipt.txHash),
    payer: state.address,
  };
}
