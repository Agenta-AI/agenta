// Dashboard shape for the project Analytics page: adds the prompt/completion
// split, latency min/max/p95, and a run-level failed count. See data-contract.md.

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
    costPrompt: number
    costCompletion: number
    /** prompt + completion */
    cost: number
    tokensPrompt: number
    tokensCompletion: number
    /** prompt + completion */
    tokens: number
}

export interface AgentAnalyticsTotals {
    totalRuns: number
    successRuns: number
    failedRuns: number
    /** successful runs / total runs, 0..1 */
    successRate: number
    /** avg latency in ms */
    avgLatency: number
    totalCost: number
    totalTokens: number
}

export interface AgentAnalyticsWindow {
    buckets: AgentAnalyticsBucket[]
    totals: AgentAnalyticsTotals
}

export interface AgentAnalyticsDashboard {
    current: AgentAnalyticsWindow
    /** Equal-length window immediately before the current one, for change badges. */
    previous: AgentAnalyticsTotals
}
