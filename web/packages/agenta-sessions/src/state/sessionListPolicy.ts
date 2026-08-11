import type {SessionExpansion, SessionListFilters} from "@agenta/entities/session"

export type SessionOriginPolicy = "all" | "exclude-trigger" | "trigger-only"

export interface SessionListRequestPolicy {
    origin: SessionOriginPolicy
    expansions: readonly SessionExpansion[]
}

export const sessionListRequestFilters = (
    policy: SessionListRequestPolicy,
): Pick<SessionListFilters, "origins" | "excludeOrigins" | "expand"> => ({
    origins: policy.origin === "trigger-only" ? ["trigger"] : undefined,
    excludeOrigins: policy.origin === "exclude-trigger" ? ["trigger"] : undefined,
    expand: [...policy.expansions],
})

export const selectedSessionListPolicy = (
    automationMode: boolean,
    defaultPolicy: SessionListRequestPolicy,
    automationPolicy: SessionListRequestPolicy,
): SessionListRequestPolicy => (automationMode ? automationPolicy : defaultPolicy)

export const sessionListIdGroupLimit = (
    sessionIds: readonly string[] | undefined,
    requestedLimit: number | undefined,
): number | undefined => {
    if (sessionIds === undefined) return requestedLimit
    return Math.max(1, requestedLimit ?? 0, new Set(sessionIds).size)
}
