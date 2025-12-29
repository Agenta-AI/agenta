import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {OrgDetails} from "@/oss/lib/Types"
import {fetchSingleOrg} from "@/oss/services/organization/api"
import {fetchAllProjects} from "@/oss/services/project"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {requestNavigationAtom} from "@/oss/state/appState"
import {settingsTabAtom} from "@/oss/state/settings"

import {getLastUsedProjectId, projectsAtom} from "../project/selectors/project"

import {
    cacheWorkspaceOrgPair,
    orgsQueryAtom,
    selectedOrgQueryAtom,
    selectedOrgIdAtom,
    orgsAtom,
    selectedOrgAtom,
} from "./selectors/org"

const EmptyOrgs: OrgDetails[] = []

const projectMatchesWorkspace = (
    project: {workspace_id?: string | null; organization_id?: string | null},
    workspaceId: string,
) => {
    if (!workspaceId) return false
    if (project.workspace_id && project.workspace_id === workspaceId) return true
    if (project.organization_id && project.organization_id === workspaceId) return true
    return false
}

const pickPreferredProjectForWorkspace = (
    projects: ProjectsResponse[],
    workspaceId: string,
): ProjectsResponse | null => {
    if (!projects.length) return null
    const workspaceProjects = projects.filter((project) =>
        projectMatchesWorkspace(project, workspaceId),
    )
    if (!workspaceProjects.length) return null

    const workspaceDefault = workspaceProjects.find((project) => project.is_default_project)
    if (workspaceDefault) return workspaceDefault

    const nonDemo = workspaceProjects.find((project) => !project.is_demo)
    return nonDemo ?? workspaceProjects[0]
}

export const useOrgData = () => {
    const queryClient = useQueryClient()
    const router = useRouter()
    const [{data: orgs, isPending: loadingOrgs, refetch: refetchOrgs}] = useAtom(orgsQueryAtom)
    const [{data: selectedOrg, isPending: loadingDetails, refetch: refetchSelectedOrg}] =
        useAtom(selectedOrgQueryAtom)
    const navigate = useSetAtom(requestNavigationAtom)
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const settingsTab = useAtomValue(settingsTabAtom)

    const projects = useAtomValue(projectsAtom)

    const resolveWorkspaceForOrg = useCallback(
        async (
            organizationId: string,
        ): Promise<{workspaceId: string | null; preferredProject: ProjectsResponse | null}> => {
            const matchingProject = pickPreferredProjectForWorkspace(projects, organizationId)

            if (matchingProject) {
                return {
                    workspaceId: matchingProject.workspace_id || organizationId,
                    preferredProject: matchingProject,
                }
            }

            const fetchedProjects = await queryClient
                .fetchQuery({
                    queryKey: ["projects", "switch-org", organizationId],
                    queryFn: () => fetchAllProjects(),
                    staleTime: 30_000,
                })
                .catch(() => null)

            if (Array.isArray(fetchedProjects)) {
                const fetchedMatch = pickPreferredProjectForWorkspace(
                    fetchedProjects,
                    organizationId,
                )
                if (fetchedMatch) {
                    return {
                        workspaceId: fetchedMatch.workspace_id || organizationId,
                        preferredProject: fetchedMatch,
                    }
                }
            }

            const cachedDetails = queryClient.getQueryData<OrgDetails | null>([
                "selectedOrg",
                organizationId,
            ])

            const resolvedDetails =
                cachedDetails ??
                (await queryClient.fetchQuery({
                    queryKey: ["selectedOrg", organizationId],
                    queryFn: () => fetchSingleOrg({organizationId}),
                }))

            const workspaceId = resolvedDetails?.default_workspace?.id ?? organizationId

            if (resolvedDetails?.default_workspace?.id) {
                cacheWorkspaceOrgPair(resolvedDetails.default_workspace.id, resolvedDetails.id)
            }

            return {
                workspaceId,
                preferredProject: null,
            }
        },
        [projects, queryClient],
    )

    const changeSelectedOrg = useCallback(
        async (organizationId: string, onSuccess?: () => void) => {
            if (loadingOrgs) return
            if (!organizationId) {
                navigate({type: "href", href: "/w", method: "replace"})
                return
            }

            if (organizationId === selectedOrgId) {
                onSuccess?.()
                return
            }

            queryClient.removeQueries({queryKey: ["selectedOrg", selectedOrgId]})

            try {
                const {workspaceId, preferredProject} = await resolveWorkspaceForOrg(organizationId)
                if (!workspaceId) return

                const lastUsedProjectId = getLastUsedProjectId(workspaceId)
                if (organizationId) cacheWorkspaceOrgPair(workspaceId, organizationId)

                // Preserve current page route if on settings page
                const isOnSettingsPage = router.pathname.includes('/settings')
                const currentTab =
                    (settingsTab && settingsTab !== "workspace" ? settingsTab : undefined) ??
                    (router.query.tab as string | undefined)

                let href: string
                if (isOnSettingsPage && lastUsedProjectId) {
                    // Keep settings page and tab when switching org
                    const tabParam = currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ""
                    href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(lastUsedProjectId)}/settings${tabParam}`
                } else if (isOnSettingsPage && preferredProject) {
                    const tabParam = currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ""
                    href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(preferredProject.project_id)}/settings${tabParam}`
                } else {
                    // Default behavior for non-settings pages
                    href = lastUsedProjectId
                        ? `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(lastUsedProjectId)}/apps`
                        : preferredProject
                          ? `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(preferredProject.project_id)}/apps`
                          : `/w/${encodeURIComponent(workspaceId)}`
                }

                navigate({type: "href", href, method: "push", shallow: false})
                onSuccess?.()
            } catch (error) {
                console.error("Failed to change workspace:", error)
            }
        },
        [
            loadingOrgs,
            navigate,
            queryClient,
            resolveWorkspaceForOrg,
            router,
            selectedOrgId,
            settingsTab,
        ],
    )

    const reset = useCallback(async () => {
        await queryClient.removeQueries({queryKey: ["orgs"]})
        await queryClient.removeQueries({queryKey: ["selectedOrg"]})
        navigate({type: "href", href: "/w", method: "replace"})
    }, [navigate, queryClient])

    const refetch = useCallback(async () => {
        await refetchOrgs()
        await refetchSelectedOrg()
    }, [refetchOrgs, refetchSelectedOrg])

    return {
        orgs: orgs ?? EmptyOrgs,
        selectedOrg: selectedOrg ?? null,
        loading: loadingOrgs || loadingDetails,
        changeSelectedOrg,
        reset,
        refetch,
    }
}

export const useSelectedOrg = () => useAtomValue(selectedOrgAtom)
export const useOrgList = () => useAtomValue(orgsAtom)
