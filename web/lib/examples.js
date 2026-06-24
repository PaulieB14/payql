// Curated, guided prompts → real subgraph queries. No LLM: each "prompt" maps to
// a known subgraph + query. Every query below was validated against its subgraph
// (returns data) so a user never pays for a field error.
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
    id: "uniswap-v3-base",
    label: "Top Uniswap V3 pools on Base",
    protocol: "Uniswap V3 (Base)",
    subgraphId: "GqzP4Xaehti8KSfQmv3ZctFSjnSUYZ4En5NRsiTbvZpz",
    query: `{
  pools(first: 5, orderBy: volumeUSD, orderDirection: desc) {
    token0 { symbol }
    token1 { symbol }
    volumeUSD
  }
}`,
  },
  {
    id: "uniswap-v2-pairs",
    label: "Top Uniswap V2 pairs by volume",
    protocol: "Uniswap V2",
    subgraphId: "GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm",
    query: `{
  pairs(first: 5, orderBy: volumeUSD, orderDirection: desc) {
    token0 { symbol }
    token1 { symbol }
    volumeUSD
  }
}`,
  },
  {
    id: "aave-v2-markets",
    label: "Largest Aave markets by TVL",
    protocol: "Aave V2",
    subgraphId: "C2zniPn45RnLDGzVeGZCx2Sw3GXrbc9gL4ZfL8B8Em2j",
    query: `{
  markets(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    name
    totalValueLockedUSD
  }
}`,
  },
  {
    id: "compound-v3-markets",
    label: "Largest Compound V3 markets by TVL",
    protocol: "Compound V3",
    subgraphId: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9",
    query: `{
  markets(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    name
    totalValueLockedUSD
  }
}`,
  },
  {
    id: "compound-v2-markets",
    label: "Largest Compound V2 markets by TVL",
    protocol: "Compound V2",
    subgraphId: "4TbqVA8p2DoBd5qDbPMwmDZv3CsJjWtxo8nVSqF2tA9a",
    query: `{
  markets(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    name
    totalValueLockedUSD
  }
}`,
  },
  {
    id: "curve-pools",
    label: "Biggest Curve pools by TVL",
    protocol: "Curve",
    subgraphId: "3fy93eAT56UJsRCEht8iFhfi6wjHWXtZ9dnnbQmvFopF",
    query: `{
  liquidityPools(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    name
    totalValueLockedUSD
  }
}`,
  },
  {
    id: "balancer-pools",
    label: "Biggest Balancer pools",
    protocol: "Balancer V2",
    subgraphId: "C4ayEZP2yTXRAB8vSaTrgN4m9anTe9Mdm2ViyiAuV9TV",
    query: `{
  pools(first: 5, orderBy: totalLiquidity, orderDirection: desc) {
    name
    totalLiquidity
  }
}`,
  },
  {
    id: "ens-registrations",
    label: "Latest ENS names registered",
    protocol: "ENS",
    subgraphId: "5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH",
    query: `{
  registrations(first: 5, orderBy: registrationDate, orderDirection: desc) {
    domain { name }
    registrationDate
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
