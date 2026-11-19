import {sessionScopeFromRouteQuery, type SessionScope} from "@agenta/sessions/state"

/**
 * The scope a `/sessions` link asks for: `?mode=automation` and, behind a developer view,
 * `?agent=<id>`.
 */
export const sessionScopeFromRoute = (
    query: {mode?: string; agent?: string},
    agentLinkEnabled: boolean,
): SessionScope | undefined => {
    const base = sessionScopeFromRouteQuery({mode: query.mode})
    if (!agentLinkEnabled || !query.agent) return base
    return {...base, agentId: query.agent}
}
