import {AgentConfigSummaryCard} from "@agenta/entity-ui/agent"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"

/** The shared read-only configuration card, bound to the desktop's editing surface. */
const AgentConfigurationCard = ({appId}: {appId: string}) => {
    const {goToPlayground} = usePlaygroundNavigation()
    return (
        <AgentConfigSummaryCard appId={appId} onEdit={() => goToPlayground(undefined, {appId})} />
    )
}

export default AgentConfigurationCard
