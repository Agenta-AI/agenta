import {useCallback} from "react"

import {
    fetchToolConnection,
    useToolConnectionActions,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl} from "@agenta/shared/api"
import {message} from "@agenta/ui/app-message"

const OAUTH_POPUP = "width=600,height=700,popup=yes"

/**
 * Refreshes a connection: re-runs its provider sign-in when it needs one, else re-validates it.
 * Shared by the Settings integrations list and the agent's integration drawer.
 */
export function useRefreshToolConnection() {
    const {handleRefresh, invalidateConnections} = useToolConnectionActions()

    return useCallback(
        async (connection: ToolConnection) => {
            if (!connection.id) return
            const connectionId = connection.id
            // An OAuth popup opens inside the click, before the await, so it is not blocked.
            const oauth = /oauth/i.test(String(connection.data?.auth_scheme ?? ""))
            let popup = oauth ? window.open("", "tools_oauth", OAUTH_POPUP) : null
            try {
                const result = await handleRefresh(connectionId)

                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url

                if (typeof redirectUrl === "string" && redirectUrl) {
                    if (popup) popup.location.href = redirectUrl
                    else popup = window.open(redirectUrl, "tools_oauth", OAUTH_POPUP)

                    // Runs once, whichever exit fires first (the message or the popup closing).
                    let done = false
                    let pollTimer: ReturnType<typeof setInterval> | undefined
                    const cleanup = async () => {
                        if (done) return
                        done = true
                        if (pollTimer) clearInterval(pollTimer)
                        window.removeEventListener("message", handler)
                        window.focus()
                        // Poll the individual connection endpoint which checks
                        // Composio for status and updates is_valid in the DB.
                        try {
                            await fetchToolConnection(connectionId)
                        } catch {
                            /* best-effort */
                        }
                        invalidateConnections()
                        message.success("Connection refreshed")
                    }

                    const trustedOrigins = new Set<string>([window.location.origin])
                    for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                        if (!url) continue
                        try {
                            trustedOrigins.add(new URL(url).origin)
                        } catch {
                            // ignore invalid env URLs
                        }
                    }

                    const handler = (event: MessageEvent) => {
                        if (
                            event.data?.type === "tools:oauth:complete" &&
                            trustedOrigins.has(event.origin)
                        ) {
                            void cleanup()
                        }
                    }

                    // A blocked popup never closes, so polling for it would never end.
                    if (!popup) {
                        message.error(
                            "Your browser blocked the sign-in popup. Allow pop-ups and refresh again.",
                        )
                        return
                    }
                    window.addEventListener("message", handler)

                    // Fallback: detect popup closed
                    pollTimer = setInterval(() => {
                        if (popup?.closed) void cleanup()
                    }, 1000)
                } else {
                    popup?.close()
                    message.success("Connection refreshed")
                }
            } catch {
                popup?.close()
                message.error("Failed to refresh connection")
            }
        },
        [handleRefresh, invalidateConnections],
    )
}
