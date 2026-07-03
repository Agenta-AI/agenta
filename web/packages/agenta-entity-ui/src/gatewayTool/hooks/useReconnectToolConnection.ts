import {useCallback, useEffect, useRef, useState} from "react"

import {useToolConnectionActions} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl, queryClient} from "@agenta/shared/api"

const invalidate = () => {
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
    queryClient.invalidateQueries({queryKey: ["triggers", "connections"]})
}

/**
 * Re-run the OAuth flow for a pending/expired gateway connection. `refresh` returns a fresh
 * redirect_url (the backend re-initiates and updates the SAME connection row — no duplicate),
 * which we reopen in a popup and settle on completion. Mirrors the connect flow in ConnectDrawer.
 */
export function useReconnectToolConnection() {
    const {handleRefresh} = useToolConnectionActions()
    const [reconnectingId, setReconnectingId] = useState<string | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    useEffect(() => () => cleanupRef.current?.(), [])

    const reconnect = useCallback(
        async (connectionId: string) => {
            if (!connectionId) return
            setReconnectingId(connectionId)
            try {
                const result = await handleRefresh(connectionId)
                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url

                if (typeof redirectUrl !== "string" || !redirectUrl) {
                    // No auth link needed (e.g. already re-validated) — just settle.
                    invalidate()
                    setReconnectingId(null)
                    return
                }

                const popup = window.open(
                    redirectUrl,
                    "tools_oauth_reconnect",
                    "width=600,height=700,popup=yes",
                )
                if (!popup) {
                    setReconnectingId(null)
                    window.location.assign(redirectUrl)
                    return
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

                const finish = () => {
                    cleanupRef.current?.()
                    cleanupRef.current = null
                    window.focus()
                    invalidate()
                    setReconnectingId(null)
                }
                const handler = (event: MessageEvent) => {
                    if (
                        event.data?.type === "tools:oauth:complete" &&
                        trustedOrigins.has(event.origin)
                    ) {
                        finish()
                    }
                }
                window.addEventListener("message", handler)
                const pollTimer = setInterval(() => {
                    if (popup.closed) finish()
                }, 1000)
                cleanupRef.current = () => {
                    window.removeEventListener("message", handler)
                    clearInterval(pollTimer)
                }
            } catch {
                setReconnectingId(null)
            }
        },
        [handleRefresh],
    )

    return {reconnect, reconnectingId}
}
