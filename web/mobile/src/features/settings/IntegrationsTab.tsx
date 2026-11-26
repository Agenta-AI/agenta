import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import settingsIntegrationsCatalog from "@agenta/i18n/catalogs/settings.integrations"
import {GatewayToolsSection} from "@agenta/settings-ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/** Settings > Integrations; `edit_tools` decides whether connect asks "Who can use it". */
export const IntegrationsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const {confirm, modal} = useConfirmModal()
    const {projectCount} = useSettingsProjectGroup(workspaceId, projectId)
    const canEdit = useProjectPermission(projectId, "edit_tools")
    const t = useT(settingsIntegrationsCatalog)
    // The shared section's defaults still say "tool" for oss/ee.
    const copy = useMemo(
        () => ({
            searchPlaceholder: t("settings.integrations.searchPlaceholder"),
        }),
        [t],
    )
    return (
        <>
            <GatewayToolsSection
                confirm={confirm}
                copy={copy}
                projectCount={projectCount}
                canEdit={canEdit}
            />
            {modal}
        </>
    )
}
