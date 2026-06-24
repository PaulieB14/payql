import type { Config } from "./config.js";

/**
 * Human-readable funding instructions for an empty/low wallet. x402 payments
 * are gasless (EIP-3009), so the floor is "hold USDC" — no ETH needed to pay
 * queries. ETH is only required if the wallet itself does an on-chain swap,
 * bridge or plain transfer.
 */
export function fundingGuidance(address: string | undefined, cfg: Config): string {
  const addr = address ?? "(no wallet configured — set PAYQL_PRIVATE_KEY)";
  const lines = [
    `This wallet needs USDC on ${cfg.network} to pay for queries.`,
    `  Address: ${addr}`,
    ``,
    `x402 payments are GASLESS (EIP-3009 transferWithAuthorization): you need USDC only — no ETH.`,
    ``,
    `Ways to fund:`,
    `  - Wallet-enabled harness: run your agent's "fund"/onramp skill and deposit USDC to the address above.`,
    `  - Card -> USDC on Base via a Coinbase/CDP onramp, withdrawing to the address above.`,
    `  - Already hold funds on Base: send USDC to the address (or swap ETH->USDC, then send).`,
    `  - Cross-chain: bridge USDC to Base via Circle CCTP.`,
  ];
  if (cfg.network === "base-sepolia") {
    lines.push(`  - Testnet: use a Base Sepolia USDC faucet (e.g. Circle's testnet faucet).`);
  }
  return lines.join("\n");
}
