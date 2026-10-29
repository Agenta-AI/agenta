import {ModelSetupBanner} from "@agenta/chat/components"

import {useOpenModelSetup} from "./useOpenModelSetup"

/** The needs-setup banner at the top of the config pane, only when the agent's model needs setup. */
export const ModelSetupNotice = ({revisionId}: {revisionId: string}) => {
    const openModelSetup = useOpenModelSetup()
    return (
        <div className="px-4">
            <ModelSetupBanner revisionId={revisionId} layout="alert" onSetUp={openModelSetup} />
        </div>
    )
}
