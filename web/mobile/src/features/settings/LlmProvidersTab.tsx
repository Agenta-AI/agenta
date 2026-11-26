import {useMemo} from "react"

import {organizationConnectionsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsLlmProvidersTabCatalog from "@agenta/i18n/catalogs/settings.llmProvidersTab"
import {AIProvidersPage, useEntitlements, type AIProvidersOrganization} from "@agenta/settings-ui"
import {isEE} from "@agenta/shared/api"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useOrganizationProjects} from "../nav/useOrganizationProjects"

import {ConfirmModal} from "./ConfirmModal"
import type {SettingsTabProps} from "./settingsTabProps"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/**
 * The organization the page names, from the project list the nav already holds (the root
 * picker's own query key and staleTime): it costs no request. Null until it resolves, which
 * leaves the page on the project's connections alone for that moment.
 */
const useProvidersOrganization = (
    workspaceId: string,
    projectId: string,
): AIProvidersOrganization | null => {
    const {currentGroup: group, currentProject: current} = useOrganizationProjects(
        workspaceId,
        projectId,
    )
    const enterprise = isEE()
    const {basePath} = useRouter()
    const manage = useAtomValue(organizationConnectionsAccessAtom) === "manage"
    // Only an owner or admin chooses projects, so only they read the plan.
    const entitlements = useEntitlements({projectId, enabled: enterprise && manage})

    return useMemo(() => {
        if (!group?.organizationId || !current) return null
        return {
            projectName: current.project_name,
            name: group.organizationName,
            projectChoice: !enterprise
                ? "all"
                : entitlements.hasRBAC
                  ? "choose"
                  : entitlements.isLoading || !manage
                    ? "pending"
                    : "plan",
            // A plain link, so it carries this app's base path itself.
            plansHref: `${basePath}/w/${workspaceId}/p/${projectId}/settings?tab=billing`,
        }
    }, [group, current, workspaceId, projectId, enterprise, entitlements, manage, basePath])
}

/**
 * Mobile binding: the same AI-providers page the desktop renders, with this app's bottom
 * modal as the removal confirmation, the project switch heading the project's group, and the
 * organization's group.
 */
export const LlmProvidersTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const t = useT(commonCatalog, settingsLlmProvidersTabCatalog)
    const organization = useProvidersOrganization(workspaceId, projectId)
    const {projectSwitch} = useSettingsProjectGroup(workspaceId, projectId)
    return (
        <AIProvidersPage
            organization={organization ?? undefined}
            projectSwitch={projectSwitch}
            renderRemoveDialog={({connection, open, pending, error, onConfirm, onClose}) => (
                <ConfirmModal
                    open={open}
                    title={t("settings.llmProvidersTab.deleteTitle")}
                    description={
                        connection?.scope === "organization"
                            ? t("settings.llmProvidersTab.deleteOrganizationDescription")
                            : t("settings.llmProvidersTab.deleteProjectDescription")
                    }
                    body={
                        <div className="flex flex-col gap-1">
                            <span>{t("settings.llmProvidersTab.aboutToDelete")}</span>
                            <span className="font-medium">{connection?.name}</span>
                        </div>
                    }
                    confirmLabel={t("common.delete")}
                    pending={pending}
                    error={error}
                    onConfirm={onConfirm}
                    onClose={onClose}
                />
            )}
        />
    )
}
