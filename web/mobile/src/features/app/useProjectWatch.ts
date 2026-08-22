import {useEffect} from "react"

import {invalidateSessionListQueries} from "@agenta/entities/session"
import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {tryRefreshSession} from "@/lib/auth"

import {watchRetryDelayMs} from "../chat/watchRelay"

import {PROJECT_WATCH_LISTS, projectWatchUrl, type ProjectWatchList} from "./projectWatchRelay"

/**
 * One project-wide EventSource for the whole app, so the session lists stop showing yesterday's
 * data.
 *
 * Nothing on this surface used to tell the lists that the server had changed. The list query has
 * a 30s `staleTime`, no `refetchInterval`, and this app turns `refetchOnWindowFocus` off on the
 * shared client, so a session created or finished anywhere — including in the chat screen one tap
 * away — stayed invisible until a remount happened to find the cache older than 30s. That is why
 * navigating away and back "fixed" it.
 *
 * The desktop has had the answer all along: it mounts a project watch in its layout and maps these
 * events onto the list invalidations. This is that, for `/m`, with the same handler map. Both
 * invalidation helpers are shared and already work on this surface — the session one matches on the
 * `session-list` key token rather than an exact key, and the workflow one invalidates
 * `["workflows", "apps"]`, which is what backs this app's agents list — and both apps use the same
 * query client, so nothing else has to change. (The desktop's own agents table has a separate
 * `agents-workflows` key that exists only there, which is why it invalidates one more thing.)
 *
 * Lifecycle follows `useSessionWatch`: foreground-only, transient errors ride EventSource's own
 * reconnect, and a fatal CLOSED refreshes the session first (the usual cause is a 401 at the
 * token-refresh boundary, and a stream has no interceptor to retry for it) before reopening on a
 * jittered backoff. `ready` invalidates as well as `session-changed`, which is what covers
 * everything that changed while the phone was asleep or the tab was in the background.
 */
export const useProjectWatch = (): void => {
    const projectId = useAtomValue(projectIdAtom)

    useEffect(() => {
        if (!projectId) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        // Built once, up here, where `projectId` is still narrowed: `open` is a hoisted function
        // declaration, so TypeScript will not carry the null check into it.
        const url = projectWatchUrl(projectId)
        let source: EventSource | null = null
        let retryHandle: number | undefined
        let disposed = false
        let attempt = 0

        const refresh = (lists: readonly ProjectWatchList[]) => {
            if (lists.includes("sessions")) invalidateSessionListQueries()
            if (lists.includes("workflows")) invalidateWorkflowsListCache()
        }

        const close = () => {
            source?.close()
            source = null
        }

        const scheduleRetry = () => {
            if (disposed || retryHandle !== undefined) return
            const delay = watchRetryDelayMs(attempt)
            attempt += 1
            retryHandle = window.setTimeout(() => {
                retryHandle = undefined
                void tryRefreshSession().finally(open)
            }, delay)
        }

        function open() {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const es = new EventSource(url, {
                withCredentials: true,
            })
            source = es
            es.onopen = () => {
                attempt = 0
            }
            // Keyed on `ready`, not `onopen`: headers arrive before the server's subscription is
            // live, so a change landing in that window would miss both this refetch and the
            // stream.
            for (const [event, lists] of Object.entries(PROJECT_WATCH_LISTS)) {
                es.addEventListener(event, () => refresh(lists))
            }
            es.onerror = () => {
                // CONNECTING means the built-in auto-reconnect has it; only a fatal CLOSED
                // needs us.
                if (es.readyState === EventSource.CLOSED) {
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
            close()
        }
    }, [projectId])
}
