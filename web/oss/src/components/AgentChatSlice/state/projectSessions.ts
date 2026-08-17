import {useEffect} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {isValidUUID} from "@/oss/lib/helpers/validators"
import {sessionListPolicies} from "@agenta/sessions/state"
import {projectIdAtom} from "@/oss/state/project"

import {projectSessionSummary, queryProjectSessions} from "./projectSessionsQuery"
import {reconcileServerSessionsAtomFamily} from "./sessions"

/**
 * The durable session list for ONE agent, from the server — the cross-device source the sidebar
 * reconciles over its localStorage cache. Scoped by the agent's `appId` (the workflow artifact id,
 * which is the chat scope key): `/sessions/query` matches it against the turns' workflow references
 * (`references: [{id: appId}]`). Includes ended sessions (a row with `deleted_at` set).
 *
 * Mirrors `liveness.ts`: ONE low-priority query per agent backs the whole list, revalidated on tab
 * refocus and on a slow interval, so it stays out of the live conversation's way. Disabled for
 * non-agent scopes (`__global__`, the revision drawer, the onboarding pseudo-scope) that have no
 * real app UUID to match — the API validates `references[].id` as a UUID and 422s otherwise.
 */
const isQueryableScope = (appId: string): boolean => Boolean(appId) && isValidUUID(appId)

export const projectSessionsQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<SessionStream[] | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: [
                "internal-reconciliation",
                projectId,
                appId,
                sessionListPolicies.internal.origin,
                sessionListPolicies.internal.expansions,
            ],
            queryFn: ({signal}) =>
                queryProjectSessions({projectId: projectId ?? "", appId, abortSignal: signal}),
            enabled: Boolean(projectId) && isQueryableScope(appId),
            staleTime: 30_000,
            refetchInterval: 60_000,
            refetchOnWindowFocus: true,
        }
    }),
)

/**
 * The agent's server sessions, newest activity first and deduped by `session_id` (a resumed session
 * can carry a stale tombstone row alongside its live one — keep the most recently touched). The
 * reconciler folds this into the localStorage session list.
 */
export const projectSessionsAtomFamily = atomFamily((appId: string) =>
    atom((get): SessionStream[] => {
        const sessions = get(projectSessionsQueryAtomFamily(appId)).data ?? []
        const byId = new Map<string, SessionStream>()
        for (const s of sessions) {
            const prior = byId.get(s.session_id)
            if (!prior || activity(s) >= activity(prior)) byId.set(s.session_id, s)
        }
        return [...byId.values()].sort((a, b) => activity(b) - activity(a))
    }),
)

/** Last-activity epoch for ordering/dedup: heartbeat `updated_at`, falling back to `created_at`.
 * The server (`/sessions/query`) now orders by `updated_at` too (WP0-R1) — this client-side sort
 * is belt-and-suspenders (dedup still needs it to pick the fresher of two rows for one session_id). */
const activity = (s: SessionStream): number => {
    const ts = s.updated_at ?? s.created_at
    const ms = ts ? Date.parse(ts) : NaN
    return Number.isNaN(ms) ? 0 : ms
}

/**
 * Fold the agent's server session list into the localStorage cache whenever a fetch succeeds.
 * Call once where the scope is known (the panel). Gated on query success AND non-null data — a
 * failed fetch (`querySessions` returns null) must NOT run the reconcile, or it would drop every
 * server-known session. A genuinely empty result (`[]`) is a real "no sessions" and does reconcile.
 */
export function useReconcileServerSessions(scopeKey: string): void {
    const query = useAtomValue(projectSessionsQueryAtomFamily(scopeKey))
    const sessions = useAtomValue(projectSessionsAtomFamily(scopeKey))
    const reconcile = useSetAtom(reconcileServerSessionsAtomFamily(scopeKey))

    const succeeded = query.isSuccess && query.data != null
    useEffect(() => {
        if (!succeeded) return
        reconcile(sessions.map(projectSessionSummary))
    }, [succeeded, sessions, reconcile])
}
