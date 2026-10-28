import {ModelSetupBanner} from "@agenta/chat/components"

import {useOpenModelSetup} from "./useOpenModelSetup"

/** The needs-setup banner above the composer, shown only when the agent's model needs setup. */
export const ModelSetupStrip = ({revisionId}: {revisionId: string}) => {
    const openModelSetup = useOpenModelSetup()
    return <ModelSetupBanner revisionId={revisionId} layout="strip" onSetUp={openModelSetup} />
}
