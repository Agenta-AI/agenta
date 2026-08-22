import {useWatchEventSource} from "@agenta/sessions/watch"

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
    onRecordsChanged,
    onInteractionChanged,
}: {
    sessionId: string
    projectId?: string | null
    enabled: boolean
    onRecordsChanged: () => void
    onInteractionChanged: () => void
}): void => {
    const url = sessionId && projectId ? sessionWatchUrl(sessionId, projectId) : null
    useWatchEventSource({
        url,
        enabled,
        refreshSession,
        on: {
            ready: onRecordsChanged,
            "records-changed": onRecordsChanged,
            interaction: onInteractionChanged,
        },
    })
}
