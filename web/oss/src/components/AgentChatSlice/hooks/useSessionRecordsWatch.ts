import {useRef} from "react"

import {shouldRefreshLegacyObserverLiveness} from "@agenta/chat/model"
import {invalidateSessionDurableApprovalsCapability} from "@agenta/entities/session"
import {useWatchEventSource} from "@agenta/sessions/watch"
import {useQueryClient} from "@tanstack/react-query"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {refreshSession} from "@/oss/lib/helpers/auth/refreshSession"

/** Watch endpoint URL — same-origin `/api` + cookie auth, consumed via native EventSource. */
const sessionWatchUrl = (sessionId: string, projectId: string): string =>
    `${getAgentaApiUrl()}/sessions/streams/watch?session_id=${encodeURIComponent(
        sessionId,
    )}&project_id=${encodeURIComponent(projectId)}`

/**
 * Live records and interaction-row relay for the active desktop conversation.
 *
 * The shared watch lifecycle keeps the foreground-only connection, bounded jittered retries,
 * token refresh on fatal close, ready revalidation, and throttled trailing refresh.
 */
export const useSessionRecordsWatch = ({
    sessionId,
    projectId,
    enabled,
    onReady,
    onRecordsChanged,
    onInteractionChanged,
    sharedReaderAdvertised,
}: {
    sessionId: string
    projectId?: string | null
    enabled: boolean
    /** Fires on every connect — a tab activation, a return to the foreground. Separate from
     * `onRecordsChanged` so it can skip a log the caller has just read (#6296). */
    onReady: () => void
    onRecordsChanged: () => void
    onInteractionChanged: (event: MessageEvent<string>) => void
    sharedReaderAdvertised: boolean
}): void => {
    const queryClient = useQueryClient()
    const lastLivenessRefreshAtRef = useRef(0)
    const url = sessionId && projectId ? sessionWatchUrl(sessionId, projectId) : null
    const refreshLiveness = () => {
        lastLivenessRefreshAtRef.current = Date.now()
        void queryClient.invalidateQueries({queryKey: ["session-liveness"]})
    }
    const refreshLegacyObserverLiveness = () => {
        const now = Date.now()
        if (
            !shouldRefreshLegacyObserverLiveness({
                sharedReaderAdvertised,
                lastRefreshAt: lastLivenessRefreshAtRef.current,
                now,
            })
        )
            return
        refreshLiveness()
    }
    useWatchEventSource({
        url,
        enabled,
        refreshSession,
        on: {
            ready: () => {
                if (projectId) {
                    invalidateSessionDurableApprovalsCapability({projectId, sessionId})
                }
                onReady()
            },
            "records-changed": () => {
                onRecordsChanged()
                refreshLegacyObserverLiveness()
            },
            interaction: onInteractionChanged,
            // A session that ends without this tab running it — a Stop from elsewhere, or the
            // execution watchdog settling a turn whose runner went silent. The records arrive
            // on their own event; this is the half that stops the session still LOOKING alive,
            // which otherwise waits out the 15s liveness poll. Mobile already does this
            // (web/mobile/src/features/chat/useSessionWatch.ts).
            lifecycle: refreshLiveness,
        },
    })
}
