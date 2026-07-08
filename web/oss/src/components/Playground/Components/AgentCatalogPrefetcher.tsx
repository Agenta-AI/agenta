import {agTypeSchemaAtomFamily, harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
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
    return null
}

export default AgentCatalogPrefetcher
