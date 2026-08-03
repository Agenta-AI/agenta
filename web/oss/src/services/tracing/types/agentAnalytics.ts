// Dashboard shape for the project Analytics page. Cost is a single coverage-gated
// total; tokens carry a total plus a coverage-gated prompt/completion split. See
// docs/design/agent-analytics/data-contract.md.

export interface AgentAnalyticsBucket {
    timestamp: string
    /** success + failed */
    runs: number
    success: number
    failed: number
    /** avg latency in ms */
    latencyAvg: number
    latencyMin: number
    latencyMax: number
    latencyP95: number
    /** total cost from `gen_ai.usage.cost` */
    cost: number
    /** total tokens from `tokens.cumulative.total` */
    tokens: number
    tokensPrompt: number
    tokensCompletion: number
}

export interface AgentAnalyticsTotals {
    totalRuns: number
    totalCost: number
    totalTokens: number
    /** cost samples in the window; compare against totalRuns for coverage gating */
    costCount: number
    /** prompt/completion token samples; compare against totalRuns for coverage gating */
    tokenSplitCount: number
}

export interface AgentAnalyticsBreakdownItem {
    /** stable category value (harness kind, model alias, or agent id) */
    key: string
    /** display label; falls back to the key when no friendlier name is known */
    label: string
    count: number
}

export interface AgentAnalyticsBreakdowns {
    harness: AgentAnalyticsBreakdownItem[]
    model: AgentAnalyticsBreakdownItem[]
    agent: AgentAnalyticsBreakdownItem[]
}

export interface AgentAnalyticsWindow {
    buckets: AgentAnalyticsBucket[]
    totals: AgentAnalyticsTotals
    breakdowns: AgentAnalyticsBreakdowns
}

export interface AgentAnalyticsDashboard {
    current: AgentAnalyticsWindow
}
