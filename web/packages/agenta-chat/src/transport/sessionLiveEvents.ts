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

export interface SessionLiveEventsConnection {
    close: () => void
}

export const sessionLiveEventsUrl = (sessionId: string, after = 0): string =>
    `${getAgentaApiUrl()}/sessions/${encodeURIComponent(sessionId)}/events?after=${Math.max(0, after)}`

/** Native EventSource transport for uncoalesced live frames. */
export const connectSessionLiveEvents = ({
    sessionId,
    after,
    onFrame,
    onEvent,
    onReady,
    onDisconnect,
}: {
    sessionId: string
    after: number
    onFrame: (frame: SessionLiveFrame) => void
    onEvent: (event: SessionDurableEvent) => void
    onReady: () => void
    onDisconnect: (event: SessionLiveDisconnect) => void
}): SessionLiveEventsConnection => {
    const source = new EventSource(sessionLiveEventsUrl(sessionId, after), {withCredentials: true})

    source.onmessage = (event) => {
        try {
            const parsed = safeParseWithLogging(
                sessionLiveFrameSchema.or(sessionDurableEventSchema),
                JSON.parse(event.data),
                "[sessionLiveEvents]",
            )
            if (parsed?.session_id === sessionId) {
                if (parsed.kind === "frame") onFrame(parsed)
                else onEvent(parsed)
            }
        } catch {
            // Ignore malformed JSON because live relay envelopes are display-only.
        }
    }
    source.addEventListener("ready", onReady)
    source.addEventListener("relay-close", (event) => {
        let detail: SessionLiveDisconnect = {reason: "relay_closed", reconnect: true}
        try {
            const data = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>
            detail = {
                reason: typeof data.reason === "string" ? data.reason : detail.reason,
                reconnect: data.reconnect !== false,
            }
        } catch {
            // The close itself is authoritative even if its optional detail is malformed.
        }
        onDisconnect(detail)
        if (!detail.reconnect) source.close()
    })
    source.onerror = () => onDisconnect({reason: "connection_lost", reconnect: true})

    return {close: () => source.close()}
}
