import {useEffect, useRef} from "react"

import {useAtomValue} from "jotai"
import Session from "supertokens-auth-react/recipe/session"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const MIN_INTERVAL_MS = 3_000

const retryDelayMs = (attempt: number): number =>
    Math.round(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS) * (0.5 + Math.random() / 2))

export type WatchEventHandler = (event: MessageEvent<string>) => void
export type WatchEventHandlers = Record<string, WatchEventHandler>

export const useWatchEventSource = ({
    url,
    enabled = true,
    on,
}: {
    url: string | null
    enabled?: boolean
    on: WatchEventHandlers
}): void => {
    const onRef = useRef(on)
    onRef.current = on
    const eventNamesKey = Object.keys(on).sort().join("|")

    useEffect(() => {
        if (!enabled || !url) return
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") return

        const eventNames = eventNamesKey ? eventNamesKey.split("|") : []
        let source: EventSource | null = null
        let retryHandle: number | undefined
        let trailingHandle: number | undefined
        let disposed = false
        let lastNotifiedAt: number | null = null
        let attempt = 0
        const pendingEvents = new Map<string, MessageEvent<string>>()

        const flushPending = () => {
            const pending = [...pendingEvents.entries()]
            pendingEvents.clear()
            for (const [eventName, event] of pending) {
                onRef.current[eventName]?.(event)
            }
        }

        const notify = (eventName: string, event: MessageEvent<string>) => {
            pendingEvents.set(eventName, event)
            const now = Date.now()
            const elapsed = lastNotifiedAt === null ? MIN_INTERVAL_MS : now - lastNotifiedAt
            if (elapsed >= MIN_INTERVAL_MS) {
                if (trailingHandle !== undefined) window.clearTimeout(trailingHandle)
                trailingHandle = undefined
                lastNotifiedAt = now
                flushPending()
                return
            }
            if (trailingHandle !== undefined) return
            trailingHandle = window.setTimeout(() => {
                trailingHandle = undefined
                lastNotifiedAt = Date.now()
                flushPending()
            }, MIN_INTERVAL_MS - elapsed)
        }

        const close = () => {
            source?.close()
            source = null
        }

        const open = () => {
            if (disposed || source !== null || document.visibilityState !== "visible") return
            const eventSource = new EventSource(url, {withCredentials: true})
            source = eventSource
            eventSource.onopen = () => {
                attempt = 0
            }
            for (const eventName of eventNames) {
                eventSource.addEventListener(eventName, (event) => {
                    notify(eventName, event as MessageEvent<string>)
                })
            }
            eventSource.onerror = () => {
                if (eventSource.readyState !== EventSource.CLOSED) return
                close()
                if (disposed || retryHandle !== undefined) return
                const delay = retryDelayMs(attempt)
                attempt += 1
                retryHandle = window.setTimeout(() => {
                    retryHandle = undefined
                    void Session.attemptRefreshingSession()
                        .catch(() => false)
                        .finally(open)
                }, delay)
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
            if (trailingHandle !== undefined) window.clearTimeout(trailingHandle)
            close()
        }
    }, [enabled, eventNamesKey, url])
}

export type ProjectWatchEvent = "ready" | "session-changed" | "workflow-changed"
export type ProjectWatchHandlers = Record<ProjectWatchEvent, WatchEventHandler>

export const useProjectWatch = ({on}: {on: ProjectWatchHandlers}): void => {
    const projectId = useAtomValue(projectIdAtom)
    const url = projectId
        ? `${getAgentaApiUrl()}/sessions/watch?project_id=${encodeURIComponent(projectId)}`
        : null

    useWatchEventSource({url, on})
}
