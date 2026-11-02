import {GatewayToolsSection} from "@agenta/settings-ui"

import {INTEGRATIONS_SECTION_COPY} from "@/lib/integrationsCopy"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/** Settings > Integrations; `edit_tools` decides whether connect asks "Who can use it". */
export const IntegrationsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const {projectSwitch, projectName, projectCount} = useSettingsProjectGroup(
        workspaceId,
        projectId,
        "tools",
    )
    const canEdit = useProjectPermission(projectId, "edit_tools")
    return (
        <>
            <GatewayToolsSection
                confirm={confirm}
                copy={INTEGRATIONS_SECTION_COPY}
                projectSwitch={projectSwitch}
                projectName={projectName}
                projectCount={projectCount}
                canEdit={canEdit}
            />
            {modal}
        </>
    )
}
