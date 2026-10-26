import {useMemo} from "react"

import {organizationConnectionsAccessAtom} from "@agenta/entities/secret"
import {AIProvidersPage, useEntitlements, type AIProvidersOrganization} from "@agenta/settings-ui"
import {isEE} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {groupByOrganization} from "@/features/context/workspaceGroups"
import {fetchProjects} from "@/lib/context"

import {ConfirmModal} from "./ConfirmModal"
import type {SettingsTabProps} from "./settingsTabProps"

/**
 * The organization the tabs name, from the project list the nav already holds (the root picker's
 * own query key and staleTime): it costs no request. Null until it resolves, which leaves the
 * page on the project's connections alone for that moment.
 */
const useOrganizationTabs = (
    workspaceId: string,
    projectId: string,
): AIProvidersOrganization | null => {
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const enterprise = isEE()
    // Only an owner or admin chooses projects, so only they need the plan's entitlements.
    const manage = useAtomValue(organizationConnectionsAccessAtom) === "manage"
    const entitlements = useEntitlements({projectId, enabled: enterprise && manage})

    return useMemo(() => {
        if (query.data?.kind !== "ok") return null
        const group = groupByOrganization(query.data.projects).find((candidate) =>
            candidate.projects.some(
                (project) =>
                    project.project_id === projectId && project.workspace_id === workspaceId,
            ),
        )
        const current = group?.projects.find((project) => project.project_id === projectId)
        if (!group?.organizationId || !current) return null
        return {
            projectName: current.project_name ?? "Project",
            name: group.organizationName,
            projects: group.projects.map((project) => ({
                id: project.project_id,
                name: project.project_name ?? "Project",
            })),
            projectChoice: !enterprise
                ? "all"
                : entitlements.hasRBAC
                  ? "choose"
                  : entitlements.isLoading || !manage
                    ? "pending"
                    : "plan",
            plansHref: `/w/${workspaceId}/p/${projectId}/settings?tab=billing`,
        }
    }, [query.data, workspaceId, projectId, enterprise, entitlements, manage])
}

/**
 * Mobile binding: the same AI-providers page the desktop renders, with this app's bottom
 * modal as the removal confirmation, and the Project and Organization tabs.
 */
export const LlmProvidersTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const organization = useOrganizationTabs(workspaceId, projectId)
    return (
        <AIProvidersPage
            organization={organization ?? undefined}
            renderRemoveDialog={({connection, open, pending, error, onConfirm, onClose}) => (
                <ConfirmModal
                    open={open}
                    title="Are you sure you want to delete?"
                    description={
                        connection?.scope === "organization"
                            ? "Agents that use this connection will need configuration, in every project that uses it."
                            : "This action is not reversible. Agents and prompts using this connection stop working."
                    }
                    body={
                        <div className="flex flex-col gap-1">
                            <span>You are about to delete:</span>
                            <span className="font-medium">{connection?.name}</span>
                        </div>
                    }
                    confirmLabel="Delete"
                    pending={pending}
                    error={error}
                    onConfirm={onConfirm}
                    onClose={onClose}
                />
            )}
        />
    )
}
