import {useCallback, useEffect, useRef, useState} from "react"

import {createToolConnection} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl, getHostQueryClient} from "@agenta/shared/api"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
import {message} from "@agenta/ui"

const invalidate = () => {
    const queryClient = getHostQueryClient()
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
    queryClient.invalidateQueries({queryKey: ["triggers", "connections"]})
}

export interface DirectConnectInput {
    integrationKey: string
    integrationName: string
    authSchemes?: string[]
    /** How many connections this integration already has — names the new one `Name 2`, `Name 3`… */
    existingCount?: number
}

/**
 * One-click connect: create the connection under a generated name and open the provider's
 * auth page immediately — no naming or auth-method dialog. Composio's redirect UI carries
 * both OAuth and API-key entry, so the only choice made here is which scheme to request:
 * OAuth when the integration offers it, the key flow otherwise.
 *
 * `connectingKey` is the integration whose popup is open; `onSettled` fires after the popup
 * finishes (or is closed) and the connection queries are invalidated.
 */
export function useDirectToolConnect(onSettled?: (integrationKey: string) => void) {
    const [connectingKey, setConnectingKey] = useState<string | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)
    const onSettledRef = useRef(onSettled)
    onSettledRef.current = onSettled

    useEffect(() => () => cleanupRef.current?.(), [])

    const connect = useCallback(
        async ({
            integrationKey,
            integrationName,
            authSchemes,
            existingCount,
        }: DirectConnectInput) => {
            if (!integrationKey) return
            setConnectingKey(integrationKey)
            const name = defaultConnectionName(integrationName, existingCount ?? 0)
            const slug = generateDefaultSlug(name || integrationKey, randomAlphanumeric(3))
            const hasOauth =
                !authSchemes?.length ||
                authSchemes.some((scheme) => scheme.toLowerCase().includes("oauth"))
            try {
                const result = await createToolConnection({
                    connection: {
                        slug,
                        name: name || slug,
                        provider_key: "composio",
                        integration_key: integrationKey,
                        data: {auth_scheme: hasOauth ? "oauth" : "api_key"},
                    },
                })
                invalidate()
                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url
                if (typeof redirectUrl !== "string" || !redirectUrl) {
                    setConnectingKey(null)
                    onSettledRef.current?.(integrationKey)
                    return
                }
                const popup = window.open(
                    redirectUrl,
                    "tools_oauth",
                    "width=600,height=700,popup=yes",
                )
                if (!popup) {
                    setConnectingKey(null)
                    message.warning("Popup blocked. Redirecting in this tab.")
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
                    setConnectingKey(null)
                    onSettledRef.current?.(integrationKey)
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
                setConnectingKey(null)
            }
        },
        [],
    )

    return {connect, connectingKey}
}
