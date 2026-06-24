// Curated, guided prompts → real subgraph queries. No LLM: each "prompt" maps to
// a known subgraph + query, so the demo showcases the x402 payment loop reliably.
export const EXAMPLES = [
  {
    id: "uniswap-v3-pools",
    label: "Top Uniswap V3 pools by volume",
    protocol: "Uniswap V3",
    subgraphId: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
    query: `{
  pools(first: 5, orderBy: volumeUSD, orderDirection: desc) {
    token0 { symbol }
    token1 { symbol }
    feeTier
    volumeUSD
  }
}`,
  },
  {
    id: "graph-network",
    label: "How many subgraphs are on The Graph?",
    protocol: "The Graph Network",
    subgraphId: "DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp",
    query: `{
  graphNetwork(id: "1") {
    subgraphCount
  }
}`,
  },
];
