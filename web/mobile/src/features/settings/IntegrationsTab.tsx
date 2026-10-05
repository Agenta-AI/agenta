import {GatewayToolsSection} from "@agenta/settings-ui"

import {useConfirmModal} from "./useConfirmModal"

import {INTEGRATIONS_SECTION_COPY} from "@/lib/integrationsCopy"

/** Settings > Integrations: the shared tools section with this app's confirm dialog. */
export const IntegrationsTab = () => {
    const {confirm, modal} = useConfirmModal()
    return (
        <>
            <GatewayToolsSection confirm={confirm} copy={INTEGRATIONS_SECTION_COPY} />
            {modal}
        </>
    )
}
