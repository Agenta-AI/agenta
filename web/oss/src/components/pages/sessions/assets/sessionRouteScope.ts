import type {SessionScope} from "@agenta/sessions/state"

export const sessionRouteModes = {
    automation: "automation",
} as const

type SessionRouteMode = (typeof sessionRouteModes)[keyof typeof sessionRouteModes]

export type SessionRouteQuery = Record<string, string | string[] | undefined>

const automationSessionScope: SessionScope = {origin: "trigger"}

/**
 * Maps the public sessions route query to the existing in-memory session scope.
 *
 * The URL names a user-facing mode rather than the internal request policy, so the route stays
 * independent from how `@agenta/sessions` implements its server-side predicates.
 */
export const sessionScopeFromRouteQuery = (query: SessionRouteQuery): SessionScope | undefined => {
    if (query.mode !== sessionRouteModes.automation) return undefined
    return automationSessionScope
}

export type {SessionRouteMode}
