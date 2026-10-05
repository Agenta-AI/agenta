import {McpServersSection} from "@agenta/settings-ui"

import {useConfirmModal} from "./useConfirmModal"

/** Settings > MCPs: the shared servers section with this app's confirm dialog. */
export const McpServersTab = () => {
    const {confirm, modal} = useConfirmModal()
    return (
        <>
            <McpServersSection confirm={confirm} />
            {modal}
        </>
    )
}
