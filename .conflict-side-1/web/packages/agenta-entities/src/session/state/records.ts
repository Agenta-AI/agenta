/**
 * Centralized query state for a session's durable record log — the backend event stream that
 * backs the Inspector (Timeline + Context lenses), cross-device. Mirrors the mounts store: one
 * shared cache entry per session so every surface dedupes, low-priority fetch, and a revalidate
 * write-atom the chat fires after each finished turn (no live backend channel for records).
 */
import {recordsPersister} from "@agenta/shared/api/persist"
import {projectIdAtom} from "@agenta/shared/state"
import type {QueryKey, QueryPersister} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {querySessionRecords} from "../api/api"
import {fileRecencyFromRecords} from "../core/fileActivity"
import type {SessionRecord} from "../core/schema"

export const sessionRecordsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "records", projectId, sessionId] as const

const SESSION_RECORDS_STALE_MS = 15_000

// Single source of key + fn so atom subscribers and imperative fetches share one flight.
// Persisted to IndexedDB so a warm reload paints the transcript from disk instead of blocking
// on the (~200KB, backend-slow) records query; recordsPersister ALWAYS revalidates on restore
// — disk is never authoritative for a live, append-only log.
const sessionRecordsQueryOptions = (projectId: string, sessionId: string) => ({
    // Widened to QueryKey so fetchQuery/atomWithQuery and the persister agree on one key type.
    queryKey: sessionRecordsQueryKey(projectId, sessionId) as QueryKey,
    queryFn: ({signal}: {signal?: AbortSignal}) =>
        querySessionRecords({sessionId, projectId, abortSignal: signal, lowPriority: true}),
    staleTime: SESSION_RECORDS_STALE_MS,
    // persist-client-core bundles its own query-core types; the cast bridges the nominal split.
    persister: recordsPersister.persisterFn as unknown as QueryPersister<
        SessionRecord[] | null,
        QueryKey
    >,
})

/** The full, ordered record event log for one session. */
export const sessionRecordsQueryFamily = atomFamily((sessionId: string) =>
    atomWithQuery<SessionRecord[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            ...sessionRecordsQueryOptions(projectId, sessionId),
            enabled: Boolean(sessionId && projectId),
            refetchOnWindowFocus: false,
        }
    }),
)

export interface SessionRecordsFetchResult {
    records: SessionRecord[] | null
    /** Present when `records` came from a disk restore / stale cache: the guaranteed background
     * refetch is in flight; resolves with the fresh log (null when the refetch failed). */
    refreshed?: Promise<SessionRecord[] | null>
}

/** Imperative records fetch through the shared cache — dedupes with atom subscribers instead of
 * issuing a raw parallel request. Resolves from cache within the stale window. When the result
 * was restored from disk it resolves immediately (paint-fast) and `refreshed` delivers the
 * revalidated log: the persister's `refetchOnRestore: "always"` fires the refetch even with no
 * observers, and the chat's one-shot hydration copy needs that fresh result re-delivered. */
export const fetchSessionRecordsAtom = atom(
    null,
    async (get, _set, sessionId: string): Promise<SessionRecordsFetchResult> => {
        const projectId = get(projectIdAtom) ?? ""
        if (!projectId || !sessionId) return {records: null}
        const client = get(queryClientAtom)
        const options = sessionRecordsQueryOptions(projectId, sessionId)
        const records = await client.fetchQuery(options)
        // The persister's post-restore task (a macrotask queued before fetchQuery resolved)
        // rewrites dataUpdatedAt to the persisted timestamp and starts the always-revalidate
        // fetch — wait for it before judging freshness, or a restore reads as fresh network data.
        await new Promise((resolve) => setTimeout(resolve, 0))
        const state = client.getQueryState<SessionRecord[] | null>(options.queryKey)
        const age = state?.dataUpdatedAt
            ? Date.now() - state.dataUpdatedAt
            : Number.POSITIVE_INFINITY
        if (age <= SESSION_RECORDS_STALE_MS && state?.fetchStatus === "idle") return {records}
        // Stale/restored result: join the persister's in-flight revalidation (cancelRefetch:
        // false — don't restart it) or start the one refetch if it never fired.
        const refreshed = client
            .refetchQueries({queryKey: options.queryKey, exact: true}, {cancelRefetch: false})
            .then(() => {
                const next = client.getQueryState<SessionRecord[] | null>(options.queryKey)
                const nextAge = next?.dataUpdatedAt
                    ? Date.now() - next.dataUpdatedAt
                    : Number.POSITIVE_INFINITY
                // Refetch failed (data is still the stale restore) → nothing fresh to deliver.
                return nextAge <= SESSION_RECORDS_STALE_MS ? (next?.data ?? null) : null
            })
            .catch(() => null)
        return {records, refreshed}
    },
)

/** Durable per-file recency (newest write/edit timestamp per tool path) derived from the record
 * log — the cross-device, reload-safe source of "which file is newest". Drive surfaces merge this
 * with the live browser file-activity log (which only sees this tab's turns) so ordering is
 * correct even for files created before this tab opened or on another device. Shares the records
 * cache entry — no extra fetch beyond the one the query already makes. */
export const sessionRecordFileRecencyAtomFamily = atomFamily((sessionId: string) =>
    atom<Map<string, number>>((get) =>
        fileRecencyFromRecords(get(sessionRecordsQueryFamily(sessionId)).data),
    ),
)

/** Mark a session's records stale (a finished turn appends events). Active Inspector refetches
 * immediately; a closed Inspector refetches on next open. Fire-and-forget. */
export const revalidateSessionRecordsAtom = atom(null, (get, _set, sessionId: string) => {
    const projectId = get(projectIdAtom) ?? ""
    if (!projectId || !sessionId) return
    // `cancelRefetch: false` — mirrors `revalidateSessionMountsAtom`. A turn finishing (incl. the
    // SDK auto-resuming the restored last turn on reload) fires this while the FIRST records fetch
    // is still in flight; the default cancels that request and starts an identical one.
    void get(queryClientAtom).invalidateQueries(
        {queryKey: sessionRecordsQueryKey(projectId, sessionId)},
        {cancelRefetch: false},
    )
})
