import {useEffect, useRef} from "react"

import {
    createToolConnection,
    invalidateToolConnections,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"

/** Zero-auth Composio integrations every new workspace starts with. */
const SEED_TOOLS = [
    {key: "composio_search", name: "Composio Search"},
    {key: "browser_tool", name: "Browser Tool"},
] as const

/** Web search and a browser need no sign-in, so they connect once, silently, on arrival. */
export const useSeedToolConnections = (connections: ToolConnection[], loading: boolean) => {
    const seededRef = useRef(false)
    useEffect(() => {
        if (seededRef.current || loading) return
        seededRef.current = true
        for (const tool of SEED_TOOLS) {
            if (connections.some((item) => item.integration_key === tool.key)) continue
            void createToolConnection({
                connection: {
                    slug: generateDefaultSlug(tool.name, randomAlphanumeric(3)),
                    name: tool.name,
                    provider_key: "composio",
                    integration_key: tool.key,
                    data: {},
                },
            })
                .then(() => invalidateToolConnections())
                .catch(() => undefined)
        }
    }, [connections, loading])
}
