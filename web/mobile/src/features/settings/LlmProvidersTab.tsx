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
    return (
        <AIProvidersPage
            organization={organization ?? undefined}
            renderRemoveDialog={({connection, open, pending, error, onConfirm, onClose}) => (
                <ConfirmModal
                    open={open}
                    title={t("settings.llmProvidersTab.deleteTitle", {name: connection?.name ?? ""})}
                    description={
                        connection?.scope === "organization"
                            ? t("settings.llmProvidersTab.deleteOrganizationDescription")
                            : t("settings.llmProvidersTab.deleteProjectDescription")
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
