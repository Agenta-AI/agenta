import {useEffect, useRef, useState} from "react"

import {shouldRefreshLegacyObserverLiveness} from "@agenta/chat/model"
import {actionableInteractionsQueryKey} from "@agenta/sessions/state"
import {useQueryClient, type Query} from "@tanstack/react-query"

import {tryRefreshSession} from "@/lib/auth"

import {livenessQueryKey} from "../sessions/useLivenessPoll"

import {recheckSessionHeader} from "./useSessionHeader"
import {sessionWatchUrl, watchRetryDelayMs} from "./watchRelay"

/** Minimum spacing between two reconnect revalidations, so a reconnect loop can't fan out
 * into one full records refetch per attempt. */
const MIN_INTERVAL_MS = 3_000

/** A read this recent already covers the gap a new stream's `ready` stands for. */
const readBeforeConnect = (query: Query) =>
    Date.now() - query.state.dataUpdatedAt >= MIN_INTERVAL_MS

const COALESCE_MS = 500

/** Leading call at once; calls inside the window collapse into one trailing call at its end. */
const coalesce = (fn: () => void) => {
    let timer: number | undefined
    let pending = false
    const run = () => {
        if (timer !== undefined) {
            pending = true
            return
        }
        fn()
        timer = window.setTimeout(() => {
            timer = undefined
            if (pending) {
                pending = false
                run()
            }
        }, COALESCE_MS)
    }
    const cancel = () => {
        if (timer !== undefined) window.clearTimeout(timer)
        timer = undefined
        pending = false
    }
    return {run, cancel}
}

/**
 * The rail's head window, not its paging tail.
 *
 * Both live under the `sidebar-sessions` prefix, and the tail carries `"older"` in the third
 * slot. Invalidating the tail re-reads every page the rail has loaded, one request each, so at
 * twelve pages a single turn costs twelve requests and a turn start and settle both land here.
 * The head alone is correct for a lifecycle event: it is ordered by last activity, so the session
 * that just changed is inside its window by definition.
 */
export const isSidebarSessionHeadQuery = (queryKey: readonly unknown[]) =>
    queryKey[0] === "sidebar-sessions" && queryKey[2] !== "older"

/**
 * One EventSource per foregrounded chat screen (M3 live relay). Most events invalidate existing
 * queries; interaction events also carry committed row state for immediate gate retirement:
 *
 * - `records-changed` (and every `open`, for missed-event coverage) → `onRecordsChanged`,
 *   i.e. the transcript tick's body (`revalidateSessionRecordsAtom` + re-read).
 * - `interaction` → reduce its committed row state and invalidate the shared badge queries.
 * - `lifecycle` → invalidate liveness and the nav rail's session queries.
 *
 * Foreground-only: the source closes on `visibilitychange → hidden` and reopens on visible.
 * Transient errors ride EventSource's built-in reconnect (the server pins its delay with an
 * SSE `retry:` preamble). A fatal CLOSED drops to the callers' poll cadence and reopens on a
 * jittered backoff — after first attempting a session refresh, because the usual fatal cause
 * is a 401 at the access-token refresh boundary and a stream has no interceptor to
 * refresh-and-retry the way the Fern/axios calls do.
 */
export const useSessionWatch = ({
    sessionId,
    projectId,
    onRecordsChanged,
    onInteractionChanged,
    sharedReaderAdvertised = true,
}: {
    sessionId: string
    projectId: string
    onRecordsChanged: () => void
    onInteractionChanged?: (event: MessageEvent<string>) => void
    sharedReaderAdvertised?: boolean
}): {connected: boolean} => {
    const [connected, setConnected] = useState(false)
    const queryClient = useQueryClient()
    const onRecordsChangedRef = useRef(onRecordsChanged)
    onRecordsChangedRef.current = onRecordsChanged
    const onInteractionChangedRef = useRef(onInteractionChanged)
    onInteractionChangedRef.current = onInteractionChanged
    // A ref: this prop lands after the session row does, and reopening the stream for it costs a
    // second `ready`.
    const sharedReaderAdvertisedRef = useRef(sharedReaderAdvertised)
    sharedReaderAdvertisedRef.current = sharedReaderAdvertised

    useEffect(() => {
        if (!sessionId || !projectId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        let source: EventSource | null = null
        let retryHandle: number | undefined
        let disposed = false
        let attempt = 0
        let lastNotifiedAt = 0
        let lastLivenessRefreshAt = 0

        const recordsChanged = coalesce(() => onRecordsChangedRef.current())

        /** Reconnect coverage only — real `records-changed` events are only coalesced. */
        const notifyOnConnect = () => {
            const now = Date.now()
            if (now - lastNotifiedAt < MIN_INTERVAL_MS) return
            lastNotifiedAt = now
            recordsChanged.run()
        }

        const invalidateLiveness = (trackLegacyRefresh = false) => {
            if (trackLegacyRefresh) lastLivenessRefreshAt = Date.now()
            void queryClient.invalidateQueries({queryKey: livenessQueryKey(projectId)})
        }

        const badges = coalesce(() => {
            invalidateLiveness()
            void queryClient.invalidateQueries({
                queryKey: actionableInteractionsQueryKey(projectId),
            })
            // The rail draws the same liveness on its own rows, off its own queries. Without
            // these its dot outlives the run you are watching finish, until the next poll.
            void queryClient.invalidateQueries({
                predicate: (query) => isSidebarSessionHeadQuery(query.queryKey),
            })
            void queryClient.invalidateQueries({queryKey: ["sidebar-sessions-pinned"]})
            void queryClient.invalidateQueries({queryKey: ["sidebar-sessions-waiting"]})
        })

        // One session switch opens more than one stream (the replay screen, then the live one),
        // and each `ready` used to re-read the whole rail and cancel the read before it.
        const badgesOnConnect = () => {
            const options = {cancelRefetch: false}
            for (const queryKey of [
                livenessQueryKey(projectId),
                actionableInteractionsQueryKey(projectId),
                ["sidebar-sessions-pinned"],
                ["sidebar-sessions-waiting"],
            ]) {
                void queryClient.invalidateQueries(
                    {queryKey, predicate: readBeforeConnect},
                    options,
                )
            }
            void queryClient.invalidateQueries(
                {
                    predicate: (query) =>
                        isSidebarSessionHeadQuery(query.queryKey) && readBeforeConnect(query),
                },
                options,
            )
        }

        const close = () => {
            source?.close()
            source = null
            setConnected(false)
        }

        const scheduleRetry = () => {
            if (disposed || retryHandle !== undefined) return
            const delay = watchRetryDelayMs(attempt)
            attempt += 1
            retryHandle = window.setTimeout(() => {
                retryHandle = undefined
                // A fatal close is most often an expired access token; refresh before
                // reopening or every attempt 401s again. Reopen either way — a network
                // failure is not a reason to stop watching.
                void tryRefreshSession().finally(open)
            }, delay)
        }

        const open = () => {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const es = new EventSource(sessionWatchUrl(sessionId, projectId), {
                withCredentials: true,
            })
            source = es
            es.onopen = () => {
                setConnected(true)
                attempt = 0
            }
            // Missed-event coverage: one revalidation per (re)connect replaces any
            // replay/cursor semantics on the server. Keyed on `ready`, not `onopen`:
            // headers reach us before the server's Redis subscription is live, so a
            // change landing in that window would miss both this refetch and the stream.
            es.addEventListener("ready", () => {
                notifyOnConnect()
                badgesOnConnect()
            })
            es.addEventListener("records-changed", () => {
                recordsChanged.run()
                const now = Date.now()
                if (
                    shouldRefreshLegacyObserverLiveness({
                        sharedReaderAdvertised: sharedReaderAdvertisedRef.current,
                        lastRefreshAt: lastLivenessRefreshAt,
                        now,
                    })
                ) {
                    invalidateLiveness(true)
                }
            })
            es.addEventListener("lifecycle", () => {
                lastLivenessRefreshAt = Date.now()
                badges.run()
            })
            es.addEventListener("interaction", (event) => {
                onInteractionChangedRef.current?.(event as MessageEvent<string>)
                badges.run()
            })
            es.onerror = () => {
                setConnected(false)
                // CONNECTING = built-in auto-reconnect; only a fatal CLOSED needs us.
                if (es.readyState === EventSource.CLOSED) {
                    // The stream refuses a reader who lost the chat: re-read the session row (it
                    // carries the reader's sharing state) now, inside the same 60 s budget as its
                    // poll (a reconnect loop must not turn into one read per attempt).
                    void recheckSessionHeader({queryClient, sessionId, projectId})
                    close()
                    scheduleRetry()
                }
            }
        }

        const onVisibility = () => {
            if (document.visibilityState === "visible") open()
            else close()
        }

        document.addEventListener("visibilitychange", onVisibility)
        open()
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisibility)
            if (retryHandle !== undefined) window.clearTimeout(retryHandle)
            recordsChanged.cancel()
            badges.cancel()
            close()
        }
    }, [sessionId, projectId, queryClient])

    return {connected}
}
