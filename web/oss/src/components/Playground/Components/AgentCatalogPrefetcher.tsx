import {useEffect} from "react"

import {agTypeSchemaAtomFamily, harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {preloadAgentTemplateControl} from "@agenta/entity-ui"
import {useAtomValue} from "jotai"

/**
 * Warms the two static agent catalogs (agent-template schema + harness capabilities) as soon as the
 * playground is known to be an agent — in PARALLEL with the revision/inspect waterfall — so a cold
 * first load (empty persisted cache) doesn't gate the config sections behind `inspect` resolving
 * (the agent-template schema ref only surfaces after inspect, so it would otherwise fetch last).
 *
 * On a warm reload the persisted seed already paints instantly; this just fires the background
 * revalidate a little earlier. Renders nothing — it exists only to subscribe to (and thus trigger)
 * the queries. Mount it ONLY for agent playgrounds so prompt playgrounds never fetch agent-only data.
 */
const AgentCatalogPrefetcher = () => {
    useAtomValue(agTypeSchemaAtomFamily("agent-template"))
    useAtomValue(harnessCapabilitiesAtomFamily(""))
    // Warm the code-split agent-template control during idle time, so its download +
    // execution doesn't land in the same main-thread burst as the revision/schema
    // resolving (which froze the paint right as the panels transitioned to content).
    useEffect(() => {
        const idle = (window as Window & typeof globalThis).requestIdleCallback
        if (typeof idle === "function") {
            const id = idle(() => void preloadAgentTemplateControl(), {timeout: 2000})
            return () => window.cancelIdleCallback?.(id)
        }
        const t = window.setTimeout(() => void preloadAgentTemplateControl(), 300)
        return () => window.clearTimeout(t)
    }, [])
    return null
}

export default AgentCatalogPrefetcher
