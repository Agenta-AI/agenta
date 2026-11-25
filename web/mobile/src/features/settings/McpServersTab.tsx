import {McpServersSection} from "@agenta/settings-ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"

/** Settings > MCPs; writes follow `edit_mcp_endpoints`, tools `use_mcp_endpoints`, a sign-in neither. */
export const McpServersTab = ({projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const canEdit = useProjectPermission(projectId, "edit_mcp_endpoints")
    const canListTools = useProjectPermission(projectId, "use_mcp_endpoints")
    return (
        <>
            <McpServersSection
                confirm={confirm}
                readOnly={!canEdit}
                canListTools={canListTools}
            />
            {modal}
        </>
    )
}
