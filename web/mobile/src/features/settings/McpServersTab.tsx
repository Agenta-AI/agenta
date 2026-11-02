import {McpServersSection} from "@agenta/settings-ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/** Settings > MCPs; writes follow `edit_mcp_endpoints`, tools `use_mcp_endpoints`, "Yours" neither. */
export const McpServersTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const canEdit = useProjectPermission(projectId, "edit_mcp_endpoints")
    const canListTools = useProjectPermission(projectId, "use_mcp_endpoints")
    const {projectSwitch, projectCount} = useSettingsProjectGroup(
        workspaceId,
        projectId,
        "mcpEndpoints",
    )
    return (
        <>
            <McpServersSection
                confirm={confirm}
                readOnly={!canEdit}
                canListTools={canListTools}
                projectSwitch={projectSwitch}
                projectCount={projectCount}
            />
            {modal}
        </>
    )
}
