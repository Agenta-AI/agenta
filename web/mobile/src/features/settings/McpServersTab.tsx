import {McpServersSection} from "@agenta/settings-ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"

/**
 * Settings > MCPs: the shared servers section with this app's confirm dialog.
 *
 * The write actions follow the same `edit_mcp_endpoints` permission the API checks on create,
 * edit, connect, disconnect and delete, and the tool list follows `use_mcp_endpoints`, which the
 * relay checks. Without roles every member holds both, so nothing is hidden.
 */
export const McpServersTab = ({projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const canEdit = useProjectPermission(projectId, "edit_mcp_endpoints")
    const canListTools = useProjectPermission(projectId, "use_mcp_endpoints")
    return (
        <>
            <McpServersSection confirm={confirm} readOnly={!canEdit} canListTools={canListTools} />
            {modal}
        </>
    )
}
