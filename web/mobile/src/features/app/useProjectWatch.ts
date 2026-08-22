import {useEffect} from "react"

import {invalidateSessionListQueries} from "@agenta/entities/session"
import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {tryRefreshSession} from "@/lib/auth"

import {watchRetryDelayMs} from "../chat/watchRelay"

import {
    PROJECT_WATCH_FALLBACK_MS,
    PROJECT_WATCH_LISTS,
    projectWatchUrl,
    type ProjectWatchList,
} from "./projectWatchRelay"

/**
 * Keeps the mobile session and workflow list caches current.
 *
 * The combined project stream is preferred. A foreground 30-second fallback remains active until
 * its `ready` event, so single-domain roles and temporary stream failures still refresh authorized
 * lists. Per-session record and lifecycle updates are handled by `useSessionWatch`.
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
        let fallbackHandle: number | undefined
        let disposed = false
        let attempt = 0

        const refresh = (lists: readonly ProjectWatchList[]) => {
            if (lists.includes("sessions")) invalidateSessionListQueries()
            if (lists.includes("workflows")) invalidateWorkflowsListCache()
        }

        const stopFallback = () => {
            if (fallbackHandle === undefined) return
            window.clearInterval(fallbackHandle)
            fallbackHandle = undefined
        }

        const startFallback = () => {
            if (disposed || fallbackHandle !== undefined || document.visibilityState !== "visible")
                return
            refresh(PROJECT_WATCH_LISTS.ready)
            fallbackHandle = window.setInterval(
                () => refresh(PROJECT_WATCH_LISTS.ready),
                PROJECT_WATCH_FALLBACK_MS,
            )
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
            for (const [event, lists] of Object.entries(PROJECT_WATCH_LISTS)) {
                es.addEventListener(event, () => {
                    if (event === "ready") stopFallback()
                    refresh(lists)
                })
            }
            es.onerror = () => {
                startFallback()
                // CONNECTING means the built-in auto-reconnect has it; only a fatal CLOSED
                // needs us.
                if (es.readyState === EventSource.CLOSED) {
                    close()
                    scheduleRetry()
                }
            }
        }

        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                startFallback()
                open()
            } else {
                stopFallback()
                close()
            }
        }

        document.addEventListener("visibilitychange", onVisibility)
        startFallback()
        open()
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisibility)
            if (retryHandle !== undefined) window.clearTimeout(retryHandle)
            stopFallback()
            close()
        }
    }, [projectId])
}
