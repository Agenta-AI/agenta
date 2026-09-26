import {axios, getAgentaApiUrl} from "@agenta/shared/api"

/** Raw micro-dollars throughout: this is the wallet's own unit, reported as the API stores it. */
export interface WalletCredit {
    id: string
    credit_kind: string
    amount_musd: number
    remaining_musd: number
    priority: number
    start_time: string | null
    end_time: string | null
    created_at: string | null
}

export interface WalletSummary {
    spendable_musd: number | null
    general_balance_musd: number | null
    floor_musd: number | null
    active_credit_total_musd: number
    credits: WalletCredit[]
}

export interface WalletUsageCharge {
    created_at: string
    category: string
    resource_key: string
    model: string | null
    provider: string | null
    amount_musd: number
    pricing_version: string
    measurement_id: string | null
    project_id: string | null
    input_tokens: number | null
    output_tokens: number | null
    cache_read_tokens: number | null
    cache_write_tokens: number | null
    request_count: number | null
    sandbox_seconds: number | null
    vcpu: number | null
    memory_gib: number | null
}

export interface WalletUsageDay {
    day: string
    category: string
    amount_musd: number
    charge_count: number
}

export interface WalletUsageSession {
    session_id: string | null
    agent_id: string | null
    agent_name: string | null
    user_id: string | null
    user_email: string | null
    started_at: string
    last_at: string
    amount_musd: number
    charge_count: number
    charges: WalletUsageCharge[]
}

export interface WalletUsage {
    start: string
    end: string
    truncated: boolean
    days: WalletUsageDay[]
    sessions: WalletUsageSession[]
}

export const fetchWalletSummary = async (projectId: string): Promise<WalletSummary> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/wallets/summary`, {
        params: {project_id: projectId},
    })
    return data.summary
}

export const fetchWalletUsage = async (
    projectId: string,
    range: {start: string; end?: string},
): Promise<WalletUsage> => {
    const {data} = await axios.post(`${getAgentaApiUrl()}/wallets/usage/query`, range, {
        params: {project_id: projectId},
    })
    return data.usage
}
