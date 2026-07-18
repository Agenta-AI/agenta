import {useEffect} from "react"

import {querySessions, type SessionStream} from "@agenta/entities/session"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {
    GLOBAL_APP_KEY,
    reconcileServerSessionsAtomFamily,
    type ServerSessionSummary,
} from "./sessions"

/**
 * The durable session list for ONE agent, from the server — the cross-device source the sidebar
 * reconciles over its localStorage cache. Scoped by the agent's `appId` (the workflow artifact id,
 * which is the chat scope key): `/sessions/query` matches it against the turns' workflow references
 * (`references: [{id: appId}]`). Includes ended sessions (a row with `deleted_at` set).
 *
 * Mirrors `liveness.ts`: ONE low-priority query per agent backs the whole list, revalidated on tab
 * refocus and on a slow interval, so it stays out of the live conversation's way. Disabled for the
 * non-agent scopes (`__global__`, the revision drawer) where there is no artifact id to match.
 */
const isQueryableScope = (appId: string): boolean =>
    Boolean(appId) && appId !== GLOBAL_APP_KEY && !appId.startsWith("drawer:")

export const projectSessionsQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<SessionStream[] | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["session-list", projectId, appId],
            queryFn: ({signal}) =>
                querySessions({
                    projectId: projectId ?? "",
                    references: [{id: appId}],
                    abortSignal: signal,
                    lowPriority: true,
                }),
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

/** Last-activity epoch for ordering/dedup: heartbeat `updated_at`, falling back to `created_at`. */
const activity = (s: SessionStream): number => {
    const ts = s.updated_at ?? s.created_at
    const ms = ts ? Date.parse(ts) : NaN
    return Number.isNaN(ms) ? 0 : ms
}

const toSummary = (s: SessionStream): ServerSessionSummary => ({
    id: s.session_id,
    title: s.name?.trim() ? s.name : undefined,
    createdAt: s.created_at ? Date.parse(s.created_at) || undefined : undefined,
})

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
        reconcile(sessions.map(toSummary))
    }, [succeeded, sessions, reconcile])
}
