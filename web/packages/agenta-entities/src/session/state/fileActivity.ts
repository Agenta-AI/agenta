/**
 * Per-session file-activity signals — the mutation foundation for "the agent just touched a
 * file" UX (auto-open a drawer on a new file, show a diff on an edit, badge the drive section).
 *
 * The chat detects settled write-ish tool calls mid-stream ({@link detectFileActivity}) and
 * records them here. Recording does three things at once:
 *  1. Appends a {@link SessionFileActivityEntry} to the session's signal log — views subscribe
 *     to the family (or `latestSessionFileActivityAtomFamily`) and react as they see fit.
 *  2. Enriches the entry from the drive cache BEFORE it goes stale: resolves the tool path to a
 *     `(mountId, mount-relative path)` the file browser can open directly, derives the effect
 *     (`created` when the cached listing lacks the path / `modified` when it has it), and
 *     snapshots the file's cached previous content — the ONLY moment a diff base is available,
 *     since revalidation refetches the new body right after.
 *  3. Revalidates the session's drive queries (throttled per session; the chat's turn-finish
 *     revalidation is the trailing backstop), so open surfaces refresh mid-turn.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {queryClientAtom} from "jotai-tanstack-query"

import {mountPathMatchesToolPath, type FileActivity} from "../core/fileActivity"
import type {MountFile} from "../core/schema"

import {mountFileContentQueryKey, revalidateSessionMountsAtom} from "./mounts"

/** What actually happened to the file, best-effort from the pre-activity drive cache. */
export type FileActivityEffect = "created" | "modified" | "deleted" | "unknown"

export interface SessionFileActivityEntry extends FileActivity {
    /** The tool call id — the dedupe key (one signal per call). */
    toolCallId: string
    sessionId: string
    at: number
    effect: FileActivityEffect
    /** The drive location, when the tool path resolved against a cached mount listing. This is
     * what a drawer/diff view needs to open the file via the mount atoms. */
    resolved?: {mountId: string; path: string}
    /** The file's cached body BEFORE this activity — the diff base for edit views. Present only
     * when the body happened to be cached (it was viewed recently). */
    previousContent?: string
}

// Bounded signal log: plenty for "react to recent activity", never a leak on long sessions.
const MAX_ENTRIES = 50
// Diff-base snapshot bound (chars ≈ bytes): keeps the whole log's worst case ~a few MB.
const MAX_SNAPSHOT_CHARS = 256 * 1024

/** Append-only (capped) log of a session's file activity, newest last. */
export const sessionFileActivityAtomFamily = atomFamily((_sessionId: string) =>
    atom<SessionFileActivityEntry[]>([]),
)

/** The most recent activity — the subscription point for auto-open/toast style reactions. */
export const latestSessionFileActivityAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const entries = get(sessionFileActivityAtomFamily(sessionId))
        return entries.length ? entries[entries.length - 1] : null
    }),
)

export const clearSessionFileActivityAtom = atom(null, (_get, set, sessionId: string) => {
    set(sessionFileActivityAtomFamily(sessionId), [])
})

// Leading-edge throttle per session: a turn writing many files revalidates once per window;
// the chat's turn-finish revalidation is the trailing backstop for anything after the edge.
const REVALIDATE_WINDOW_MS = 1500
const revalidateWindows = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Record one detected file activity. Dedupes by `toolCallId`; enriches from the drive cache;
 * throttle-revalidates the session's drives.
 */
export const recordFileActivityAtom = atom(
    null,
    (get, set, params: {sessionId: string; toolCallId: string; activity: FileActivity}) => {
        const {sessionId, toolCallId, activity} = params
        if (!sessionId || !toolCallId) return
        const logAtom = sessionFileActivityAtomFamily(sessionId)
        if (get(logAtom).some((entry) => entry.toolCallId === toolCallId)) return

        const projectId = get(projectIdAtom) ?? ""
        const queryClient = get(queryClientAtom)

        // Resolve the tool path against cached mount listings (any mount, this project).
        let resolved: SessionFileActivityEntry["resolved"]
        let sawListing = false
        for (const [key, files] of queryClient.getQueriesData<MountFile[] | null>({
            queryKey: ["mounts", "files", projectId],
        })) {
            if (!Array.isArray(files)) continue
            sawListing = true
            const hit = files.find((f) => mountPathMatchesToolPath(f.path, activity.path))
            if (hit) {
                resolved = {mountId: String(key[3] ?? ""), path: hit.path}
                break
            }
        }

        const effect: FileActivityEffect =
            activity.op === "delete"
                ? "deleted"
                : resolved
                  ? "modified"
                  : sawListing
                    ? "created"
                    : "unknown"

        // Snapshot the pre-activity body while it's still in cache (the diff base) — bounded:
        // the log holds up to 50 entries per session, so an unbounded string per entry could
        // pin tens of MB. Oversized bodies just lose their diff base.
        const cached = resolved
            ? queryClient.getQueryData<string | null>(
                  mountFileContentQueryKey(projectId, resolved.mountId, resolved.path),
              )
            : undefined
        const previousContent =
            typeof cached === "string" && cached.length <= MAX_SNAPSHOT_CHARS ? cached : undefined

        const entry: SessionFileActivityEntry = {
            ...activity,
            toolCallId,
            sessionId,
            at: Date.now(),
            effect,
            ...(resolved ? {resolved} : {}),
            ...(typeof previousContent === "string" ? {previousContent} : {}),
        }
        set(logAtom, (prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry])

        if (!revalidateWindows.has(sessionId)) {
            set(revalidateSessionMountsAtom, sessionId)
            revalidateWindows.set(
                sessionId,
                setTimeout(() => revalidateWindows.delete(sessionId), REVALIDATE_WINDOW_MS),
            )
        }
    },
)
