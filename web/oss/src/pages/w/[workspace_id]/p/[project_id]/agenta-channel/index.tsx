import {useAtomValue} from "jotai"

import AgentaChannelSurface from "@/oss/components/pages/AgentaChannelSurface/AgentaChannelSurface"
import PageTitle from "@/oss/components/PageTitle"
import {agentaChannelSurfaceEnabledAtom} from "@/oss/state/settings/featureFlags"

/** Flag-gated probe page -- nothing renders here unless the settings flag is on. */
const AgentaChannelPage = () => {
    const enabled = useAtomValue(agentaChannelSurfaceEnabledAtom)

    if (!enabled) return null

    return (
        <>
            <PageTitle title="Agenta channel" />
            <AgentaChannelSurface />
        </>
    )
}

export default AgentaChannelPage
