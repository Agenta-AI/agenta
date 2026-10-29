import {McpServersSection} from "@agenta/settings-ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/**
 * Settings > MCPs: the shared servers section with this app's confirm dialog.
 *
 * The write actions follow the same `edit_mcp_endpoints` permission the API checks on create,
 * edit, connect, disconnect and delete, and the tool list follows `use_mcp_endpoints`, which the
 * relay checks. Without roles every member holds both, so nothing is hidden. A person's own
 * sign-ins ("Yours") need neither: anyone who may run agents signs in for themselves.
 */
export const McpServersTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const canEdit = useProjectPermission(projectId, "edit_mcp_endpoints")
    const canListTools = useProjectPermission(projectId, "use_mcp_endpoints")
    const {projectSwitch} = useSettingsProjectGroup(workspaceId, projectId, "mcpEndpoints")
    return (
        <>
            <McpServersSection
                confirm={confirm}
                readOnly={!canEdit}
                canListTools={canListTools}
                projectSwitch={projectSwitch}
            />
            {modal}
        </>
    )
}
