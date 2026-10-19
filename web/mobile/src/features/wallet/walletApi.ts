import {axios, getAgentaApiUrl} from "@agenta/shared/api"

/** Raw micro-dollars throughout: this is the wallet's own unit, reported as the API stores it. */
export interface WalletCredit {
    id: string
    credit_kind: string
    amount_musd: number
    remaining_musd: number
    start_time: string | null
    end_time: string | null
    created_at: string | null
}

/** The organization's `wallets-rollout` mode. Only `enforce` shows the credits view. */
export type WalletMode = "off" | "shadow" | "enforce"

export interface WalletSummary {
    mode: WalletMode
    spendable_musd: number | null
    active_credit_total_musd: number
    credits: WalletCredit[]
}

export interface WalletUsageCharge {
    created_at: string
    amount_musd: number
}

export interface WalletUsageDay {
    day: string
    category: string
    amount_musd: number
}

export interface WalletUsageSession {
    session_id: string | null
    agent_id: string | null
    agent_name: string | null
    user_id: string | null
    user_email: string | null
    charges: WalletUsageCharge[]
}

export interface WalletUsage {
    truncated: boolean
    days: WalletUsageDay[]
    sessions: WalletUsageSession[]
}

/** The usage detail is owner-only; a 403 is an answer, not a failure. */
export const isForbidden = (error: unknown) =>
    (error as {response?: {status?: number}} | null)?.response?.status === 403

export const fetchWalletSummary = async (projectId: string): Promise<WalletSummary> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/wallets/summary`, {
        params: {project_id: projectId},
    })
    return {...data.summary, mode: data.mode}
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
