import type { Config } from "./config.js";

/**
 * Build an x402 client backed by an Ampersend-managed smart account, so paid
 * requests are gated by Ampersend's server-side spend policy (per-tx / daily /
 * monthly limits, allowlists, auto-top-ups) before they're signed.
 *
 * The Ampersend SDK is an OPTIONAL dependency — PayQL never pulls it into its
 * own tree (it ships heavy/forked deps). It's loaded dynamically only when a
 * user opts into `managed`/Ampersend mode and installs it. The returned object
 * is an `x402Client` subclass that drops straight into `wrapFetchWithPayment`,
 * exactly like the BYO path.
 */
export async function buildAmpersendClient(cfg: Config): Promise<unknown> {
  if (!cfg.ampersendSmartAccount || !cfg.ampersendSessionKey) {
    throw new Error(
      "Ampersend mode needs a smart account + session key. Set PAYQL_AMPERSEND_SMART_ACCOUNT " +
        "and PAYQL_AMPERSEND_SESSION_KEY (or AMPERSEND_AGENT_ACCOUNT / AMPERSEND_AGENT_KEY).",
    );
  }

  // Non-literal specifier keeps this a true OPTIONAL dependency: no compile-time
  // module resolution, and nothing added to package.json `dependencies`.
  const moduleName = "@ampersend_ai/ampersend-sdk";
  let sdk: any;
  try {
    sdk = await import(moduleName);
  } catch {
    throw new Error(`Ampersend mode requires the optional SDK. Install it:  npm i ${moduleName}`);
  }

  if (typeof sdk.createAmpersendHttpClient !== "function") {
    throw new Error(
      `Installed ${moduleName} has no createAmpersendHttpClient export — version mismatch? (built against ~0.0.28).`,
    );
  }

  return sdk.createAmpersendHttpClient({
    smartAccountAddress: cfg.ampersendSmartAccount,
    sessionKeyPrivateKey: cfg.ampersendSessionKey,
    clientName: "payql",
    ...(cfg.ampersendApiUrl ? { apiUrl: cfg.ampersendApiUrl } : {}),
  });
}
