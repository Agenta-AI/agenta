import {
    sessionDurableEventSchema,
    sessionLiveFrameSchema,
    type SessionDurableEvent,
    type SessionLiveFrame,
} from "@agenta/entities/session"
import {safeParseWithLogging} from "@agenta/entities/shared"
import {getAgentaApiUrl} from "@agenta/shared/api"

export interface SessionLiveDisconnect {
    reason: string
    reconnect: boolean
}

export interface SessionLiveReady {
    watermark: number
}

export interface SessionLiveEventsConnection {
    close: () => void
}

/**
 * An EventSource does not go through the API client that adds `project_id`, so the URL carries
 * it. Without it the API resolves the user's default project, not the session's project.
 */
export const sessionLiveEventsUrl = (
    sessionId: string,
    after = 0,
    projectId?: string | null,
): string => {
    const url = `${getAgentaApiUrl()}/sessions/${encodeURIComponent(sessionId)}/events?after=${Math.max(0, after)}`
    return projectId ? `${url}&project_id=${encodeURIComponent(projectId)}` : url
}

export interface SessionLiveHandlers {
    onFrame: (frame: SessionLiveFrame) => void
    onEvent: (event: SessionDurableEvent) => void
    onReady: (event: SessionLiveReady) => void
    onDisconnect: (event: SessionLiveDisconnect) => void
}

/** Route one SSE message to its handler; false means the server asked not to reconnect. */
export const dispatchSessionLiveMessage = (
    {event, data}: {event: string; data: string},
    {sessionId, after, ...handlers}: SessionLiveHandlers & {sessionId: string; after: number},
): boolean => {
    if (event === "ready") {
        let watermark = after
        try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            if (
                typeof parsed.watermark === "number" &&
                Number.isInteger(parsed.watermark) &&
                parsed.watermark >= 0
            )
                watermark = parsed.watermark
        } catch {
            // A malformed readiness detail must not move the reconnect cursor forward.
        }
        handlers.onReady({watermark})
        return true
    }
    if (event === "relay-close") {
        let detail: SessionLiveDisconnect = {reason: "relay_closed", reconnect: true}
        try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            detail = {
                reason: typeof parsed.reason === "string" ? parsed.reason : detail.reason,
                reconnect: parsed.reconnect !== false,
            }
        } catch {
            // The close itself is authoritative even if its optional detail is malformed.
        }
        handlers.onDisconnect(detail)
        return detail.reconnect
    }
    if (event !== "message") return true
    try {
        const parsed = safeParseWithLogging(
            sessionLiveFrameSchema.or(sessionDurableEventSchema),
            JSON.parse(data),
            "[sessionLiveEvents]",
        )
        if (parsed?.session_id === sessionId) {
            if (parsed.kind === "frame") handlers.onFrame(parsed)
            else handlers.onEvent(parsed)
        }
    } catch {
        // Ignore malformed JSON because live relay envelopes are display-only.
    }
    return true
}

/** Native EventSource transport for uncoalesced live frames. */
export const connectSessionLiveEvents = ({
    sessionId,
    projectId,
    after,
    ...handlers
}: SessionLiveHandlers & {
    sessionId: string
    projectId?: string | null
    after: number
}): SessionLiveEventsConnection => {
    const source = new EventSource(sessionLiveEventsUrl(sessionId, after, projectId), {
        withCredentials: true,
    })
    const dispatch = (event: string, message: Event) => {
        const keepOpen = dispatchSessionLiveMessage(
            {event, data: (message as MessageEvent<string>).data},
            {sessionId, after, ...handlers},
        )
        if (!keepOpen) source.close()
    }

    source.onmessage = (event) => dispatch("message", event)
    source.addEventListener("ready", (event) => dispatch("ready", event))
    source.addEventListener("relay-close", (event) => dispatch("relay-close", event))
    source.onerror = () => handlers.onDisconnect({reason: "connection_lost", reconnect: true})

    return {close: () => source.close()}
}
