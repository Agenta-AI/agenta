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
    const {projectSwitch, projectName, projectCount} = useSettingsProjectGroup(
        workspaceId,
        projectId,
    )
    const canEdit = useProjectPermission(projectId, "edit_tools")
    const t = useT(settingsIntegrationsCatalog)
    // The shared section's defaults still say "tool" for oss/ee.
    const copy = useMemo(
        () => ({
            run: t("settings.integrations.run"),
            searchPlaceholder: t("settings.integrations.searchPlaceholder"),
            emptyTitle: t("settings.integrations.emptyTitle"),
            emptyBody: t("settings.integrations.emptyBody"),
            noMatch: (term: string) => t("settings.integrations.noMatch", {term}),
        }),
        [t],
    )
    return (
        <>
            <GatewayToolsSection
                confirm={confirm}
                copy={copy}
                projectSwitch={projectSwitch}
                projectName={projectName}
                projectCount={projectCount}
                canEdit={canEdit}
            />
            {modal}
        </>
    )
}
