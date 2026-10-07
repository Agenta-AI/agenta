import {useCallback, useEffect, useRef, useState} from "react"

import {
    createToolConnection,
    fetchToolConnection,
    invalidateToolConnections,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"

import {openToolAuthPopup} from "../utils/openToolAuthPopup"

export interface DirectConnectInput {
    integrationKey: string
    integrationName: string
    authSchemes?: string[]
    /** Existing connections for this integration; names the new one `Name 2`, `Name 3`… */
    existingCount?: number
}

const latest = async (id: string | null | undefined): Promise<ToolConnection | null> => {
    if (!id) return null
    try {
        return (await fetchToolConnection(id)).connection ?? null
    } catch {
        return null
    }
}

/** One-click connect under a generated name; `onSettled` gets the connection as it ended up. */
export function useDirectToolConnect(
    onSettled?: (integrationKey: string, connection: ToolConnection | null) => void,
) {
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
            const settle = async (id: string | null | undefined) => {
                const connection = await latest(id)
                invalidateToolConnections()
                setConnectingKey(null)
                onSettledRef.current?.(integrationKey, connection)
            }
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
                invalidateToolConnections()
                const id = result.connection?.id
                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url
                if (typeof redirectUrl !== "string" || !redirectUrl) {
                    await settle(id)
                    return
                }
                cleanupRef.current = openToolAuthPopup(redirectUrl, () => {
                    cleanupRef.current = null
                    void settle(id)
                })
                if (!cleanupRef.current) setConnectingKey(null)
            } catch {
                setConnectingKey(null)
            }
        },
        [],
    )

    return {connect, connectingKey}
}
