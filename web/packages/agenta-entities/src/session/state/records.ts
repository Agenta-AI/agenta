/**
 * Centralized query state for a session's durable record log — the backend event stream that
 * backs the Inspector (Timeline + Context lenses), cross-device. Mirrors the mounts store: one
 * shared cache entry per session so every surface dedupes, low-priority fetch, and a revalidate
 * write-atom the chat fires after each finished turn (no live backend channel for records).
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {querySessionRecords} from "../api/api"
import {fileRecencyFromRecords} from "../core/fileActivity"
import type {SessionRecord} from "../core/schema"

export const sessionRecordsQueryKey = (projectId: string, sessionId: string) =>
    ["session", "records", projectId, sessionId] as const

/** The full, ordered record event log for one session. */
export const sessionRecordsQueryFamily = atomFamily((sessionId: string) =>
    atomWithQuery<SessionRecord[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: sessionRecordsQueryKey(projectId, sessionId),
            queryFn: ({signal}) =>
                querySessionRecords({sessionId, projectId, abortSignal: signal, lowPriority: true}),
            enabled: Boolean(sessionId && projectId),
            staleTime: 15_000,
            refetchOnWindowFocus: false,
        }
    }),
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
    void get(queryClientAtom).invalidateQueries({
        queryKey: sessionRecordsQueryKey(projectId, sessionId),
    })
})
