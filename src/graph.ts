import type { Config } from "./config.js";
import { PaymentEngine, type PaidResult } from "./x402.js";

export function subgraphUrl(cfg: Config, subgraphId: string): string {
  return `${cfg.gatewayBase}/subgraphs/id/${subgraphId}`;
}

export function gqlInit(query: string, variables?: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  };
}

// Fulltext discovery against The Graph network subgraph's `subgraphMetadataSearch`
// index (over SubgraphMeta.displayName + description), then hop to the most-signalled
// active Subgraph + its current deployment.
const SEARCH_QUERY = `query PayqlSearch($text: String!, $first: Int!) {
  subgraphMetadataSearch(text: $text, first: $first) {
    displayName
    description
    categories
    subgraphs(first: 1, where: { active: true }, orderBy: currentSignalledTokens, orderDirection: desc) {
      id
      active
      currentSignalledTokens
      currentVersion {
        subgraphDeployment {
          ipfsHash
          stakedTokens
          signalledTokens
          queryFeesAmount
        }
      }
    }
  }
}`;

// Turn a free-text query into a tsquery with prefix matching: "uniswap v3" -> "uniswap:* & v3:*"
function toFulltext(q: string): string {
  const tokens = q
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return q.trim();
  return tokens.map((t) => `${t}:*`).join(" & ");
}

export interface SubgraphHit {
  displayName: string | null;
  subgraphId: string | null;
  ipfsHash: string | null;
  currentSignalledTokensGRT: number | null;
  queryFeesGRT: number | null;
  description: string | null;
  categories: string[] | null;
  queryUrl: string | null;
}

function weiToGRT(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e18 : null;
}

export interface SearchOutcome {
  hits: SubgraphHit[];
  result: PaidResult | null;
  source: string;
  errors?: unknown;
}

export async function searchSubgraphs(
  engine: PaymentEngine,
  cfg: Config,
  query: string,
  first: number,
): Promise<SearchOutcome> {
  const variables = { text: toFulltext(query), first };
  let raw: any;
  let result: PaidResult | null = null;
  let source: string;

  if (cfg.registryUrl) {
    // Free curated discovery source (e.g. your own subgraph registry).
    const res = await fetch(cfg.registryUrl, gqlInit(SEARCH_QUERY, variables));
    raw = await res.json().catch(() => ({}));
    source = "registry";
  } else {
    // Default: a tiny paid x402 query against The Graph network subgraph.
    result = await engine.paidFetch(subgraphUrl(cfg, cfg.networkSubgraphId), gqlInit(SEARCH_QUERY, variables));
    if (result.needsHarnessPayment) return { hits: [], result, source: "x402:pending-harness-payment" };
    raw = result.data;
    source = "x402:graph-network-subgraph";
  }

  const metas: any[] = raw?.data?.subgraphMetadataSearch ?? [];
  const hits: SubgraphHit[] = metas.map((m) => {
    const sg = (m.subgraphs && m.subgraphs[0]) || null;
    const dep = sg?.currentVersion?.subgraphDeployment ?? null;
    return {
      displayName: m.displayName ?? null,
      subgraphId: sg?.id ?? null,
      ipfsHash: dep?.ipfsHash ?? null,
      currentSignalledTokensGRT: weiToGRT(sg?.currentSignalledTokens),
      queryFeesGRT: weiToGRT(dep?.queryFeesAmount),
      description: m.description ?? null,
      categories: m.categories ?? null,
      queryUrl: sg?.id ? subgraphUrl(cfg, sg.id) : null,
    };
  });
  hits.sort((a, b) => (b.currentSignalledTokensGRT ?? 0) - (a.currentSignalledTokensGRT ?? 0));
  return { hits, result, source, errors: raw?.errors };
}

const INTROSPECT_QUERY = `query PayqlIntrospect { __type(name: "Query") { fields { name args { name } } } }`;

export interface SchemaOutcome {
  entities: { name: string; args: string[] }[];
  result: PaidResult;
}

export async function introspectSchema(
  engine: PaymentEngine,
  cfg: Config,
  subgraphId: string,
): Promise<SchemaOutcome> {
  const result = await engine.paidFetch(subgraphUrl(cfg, subgraphId), gqlInit(INTROSPECT_QUERY));
  const fields: any[] = result.data?.data?.__type?.fields ?? [];
  const entities = fields
    .filter((f) => f?.name && !f.name.startsWith("_"))
    .map((f) => ({ name: f.name, args: (f.args ?? []).map((a: any) => a.name) }));
  return { entities, result };
}
