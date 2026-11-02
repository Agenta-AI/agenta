import {useEffect, useRef} from "react"

import {joinTabLeadership, type TabLeadership} from "./tabLeader"

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const MIN_INTERVAL_MS = 3_000

export const shouldCoalesceWatchEvent = (eventName: string): boolean => eventName !== "interaction"

const retryDelayMs = (attempt: number): number =>
    Math.round(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS) * (0.5 + Math.random() / 2))

export type WatchEventHandler = (event: MessageEvent<string>) => void
export type WatchEventHandlers = Record<string, WatchEventHandler>

/**
 * Renew the session before reopening a fatally-closed stream. Injected, not imported: the hosts
 * refresh through different SuperTokens builds, and `@agenta/auth` sits above this package.
 */
export type RefreshSession = () => Promise<unknown>

/**
 * One foreground-only EventSource, with the reconnect policy every Agenta watch stream needs.
 *
 * - Foreground only: the source closes on `visibilitychange → hidden` and reopens on visible, so a
 *   backgrounded tab holds no stream open.
 * - Transient errors ride EventSource's own reconnect (the server pins the delay with an SSE
 *   `retry:` preamble). Only a fatal `CLOSED` is ours to handle, on a jittered backoff — and it
 *   refreshes the session first, because the usual fatal cause is a 401 at the access-token
 *   refresh boundary and a stream carries no interceptor to refresh-and-retry the way the
 *   Fern/axios calls do.
 * - Most handlers are coalesced to one call per event name per `MIN_INTERVAL_MS`, so a burst of
 *   server events (or a reconnect loop) cannot fan out into a refetch storm. Interaction events
 *   bypass that window because a reader must see an approval answer within one second even when
 *   it follows the pending event immediately.
 * - `shareAcrossTabs`: the tab the visible tabs elected holds the stream and relays its events to
 *   the others (`tabLeader`), for a stream every tab would otherwise open for itself.
 */
export const useWatchEventSource = ({
    url,
    enabled = true,
    on,
    refreshSession,
    shareAcrossTabs = false,
}: {
    url: string | null
    enabled?: boolean
    on: WatchEventHandlers
    refreshSession: RefreshSession
    shareAcrossTabs?: boolean
}): void => {
    const onRef = useRef(on)
    onRef.current = on
    const refreshRef = useRef(refreshSession)
    refreshRef.current = refreshSession
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
        // Set while this tab takes part in a shared stream; `leading` says whether it holds it.
        let membership: TabLeadership | null = null
        let leading = false
        const pendingEvents = new Map<string, MessageEvent<string>>()

        const flushPending = () => {
            const pending = [...pendingEvents.entries()]
            pendingEvents.clear()
            for (const [eventName, event] of pending) {
                onRef.current[eventName]?.(event)
            }
        }

        const notify = (eventName: string, event: MessageEvent<string>) => {
            if (!shouldCoalesceWatchEvent(eventName)) {
                onRef.current[eventName]?.(event)
                return
            }
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
            if (membership && !leading) return
            const eventSource = new EventSource(url, {withCredentials: true})
            source = eventSource
            eventSource.onopen = () => {
                attempt = 0
            }
            for (const eventName of eventNames) {
                eventSource.addEventListener(eventName, (event) => {
                    const message = event as MessageEvent<string>
                    notify(eventName, message)
                    membership?.relay({name: eventName, data: message.data})
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
                    void Promise.resolve(refreshRef.current())
                        .catch(() => false)
                        .finally(open)
                }, delay)
            }
        }

        const onRelay = (payload: unknown) => {
            if (!payload || typeof payload !== "object") return
            const {name, data} = payload as {name?: unknown; data?: unknown}
            if (typeof name !== "string" || !eventNames.includes(name)) return
            notify(name, new MessageEvent(name, {data: typeof data === "string" ? data : ""}))
        }

        const join = () => {
            if (disposed || document.visibilityState !== "visible") return
            if (!shareAcrossTabs) {
                open()
                return
            }
            if (membership) return
            membership = joinTabLeadership({
                channelName: `agenta-watch:${url}`,
                onLeadChange: (lead) => {
                    leading = lead
                    if (lead) open()
                    else close()
                },
                onRelay,
            })
            if (!membership) {
                open()
                return
            }
            // A tab that follows hears only what happens from now on. `ready` is what a stream
            // sends on every connect to cover the gap, so the tab raises it for itself.
            if (eventNames.includes("ready")) notify("ready", new MessageEvent("ready", {data: ""}))
        }

        const leave = () => {
            membership?.leave()
            membership = null
            leading = false
            close()
        }

        const onVisibility = () => {
            if (document.visibilityState === "visible") join()
            else leave()
        }

        document.addEventListener("visibilitychange", onVisibility)
        join()
        return () => {
            disposed = true
            document.removeEventListener("visibilitychange", onVisibility)
            if (retryHandle !== undefined) window.clearTimeout(retryHandle)
            if (trailingHandle !== undefined) window.clearTimeout(trailingHandle)
            leave()
        }
    }, [enabled, eventNamesKey, shareAcrossTabs, url])
}
