import {useMemo} from "react"

import {organizationConnectionsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsLlmProvidersTabCatalog from "@agenta/i18n/catalogs/settings.llmProvidersTab"
import {AIProvidersPage, useEntitlements, type AIProvidersOrganization} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useOrganizationProjects} from "../nav/useOrganizationProjects"

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
    const {basePath} = useRouter()
    const manage = useAtomValue(organizationConnectionsAccessAtom) === "manage"
    // Only an owner or admin chooses projects, so only they read the plan.
    const entitlements = useEntitlements({projectId, enabled: manage})

    return useMemo(() => {
        if (!group?.organizationId || !current) return null
        return {
            projectName: current.project_name,
            name: group.organizationName,
            projectChoice: entitlements.hasRBAC
                ? "choose"
                : entitlements.isLoading || !manage
                  ? "pending"
                  : "plan",
            // A plain link, so it carries this app's base path itself. Self-hosted, the plan
            // comes from a license key, so the link opens the License tab.
            plansHref: `${basePath}/w/${workspaceId}/p/${projectId}/settings?tab=${
                isBillingEnabled() ? "billing" : "license"
            }`,
        }
    }, [group, current, workspaceId, projectId, entitlements, manage, basePath])
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
                <AlertDialog
                    open={open}
                    onOpenChange={(next) => {
                        if (!next && !pending) onClose()
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {t("settings.llmProvidersTab.deleteTitle", {
                                    name: connection?.name ?? "",
                                })}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {connection?.scope === "organization"
                                    ? t("settings.llmProvidersTab.deleteOrganizationDescription")
                                    : t("settings.llmProvidersTab.deleteProjectDescription")}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {error ? <p className="m-0 text-body text-destructive">{error}</p> : null}
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={onClose} disabled={pending}>
                                    {t("common.cancel")}
                                </Button>
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={pending}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        onConfirm()
                                    }}
                                >
                                    {pending ? t("common.working") : t("common.delete")}
                                </Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        />
    )
}
