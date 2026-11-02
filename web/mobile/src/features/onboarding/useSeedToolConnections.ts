import {useEffect} from "react"

import {
    createToolConnection,
    invalidateToolConnections,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {projectIdAtom} from "@agenta/shared/state"
import {generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

import {SEED_TOOLS} from "./onboardingConfig"

const seededKey = (projectId: string) => `agenta:onboarding:tools-seeded:v1:${projectId}`

/** Once per project per browser session, so a remount or reload never seeds twice. */
const claimSeed = (projectId: string): boolean => {
    try {
        if (window.sessionStorage.getItem(seededKey(projectId))) return false
        window.sessionStorage.setItem(seededKey(projectId), "1")
        return true
    } catch {
        return false
    }
}

/** Web search and a browser need no sign-in, so they connect once, silently, on arrival. */
export const useSeedToolConnections = ({
    enabled,
    connections,
    loaded,
}: {
    /** Off in a preview, which must leave the project as it found it. */
    enabled: boolean
    connections: ToolConnection[]
    /** The connections query answered; a failed or pending read cannot rule out a duplicate. */
    loaded: boolean
}) => {
    const projectId = useAtomValue(projectIdAtom)
    useEffect(() => {
        if (!enabled || !loaded || !projectId || !claimSeed(projectId)) return
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
    }, [enabled, loaded, projectId, connections])
}
