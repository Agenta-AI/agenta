import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {buildProjectSwitchHref} from "@/oss/lib/navigation/projectSwitchHref"
import type {OrgDetails} from "@/oss/lib/Types"
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
    const [{isPending: loadingOrgs, refetch: refetchOrgs}] = useAtom(orgsQueryAtom)
    // Read via orgsAtom (not raw query data) so demo orgs stay hidden
    const orgs = useAtomValue(orgsAtom)
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
            // Fast path: check already-loaded projects by org ID
            const matchingProject = pickPreferredProjectForWorkspace(projects, organizationId)
            if (matchingProject) {
                return {
                    workspaceId: matchingProject.workspace_id || organizationId,
                    preferredProject: matchingProject,
                }
            }

            // Fetch org details first to resolve the actual workspace ID. This is
            // required for newly created orgs where the workspace ID is not yet
            // known and passing org ID to the projects API would yield no results.
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

            // Fetch projects scoped to the resolved workspace ID so the backend
            // returns the correct workspace's projects instead of the user's default.
            const fetchedProjects = await queryClient
                .fetchQuery({
                    queryKey: ["projects", "switch-org", workspaceId],
                    queryFn: () => fetchAllProjects(workspaceId),
                    staleTime: 30_000,
                })
                .catch(() => null)

            if (Array.isArray(fetchedProjects)) {
                const fetchedMatch = pickPreferredProjectForWorkspace(fetchedProjects, workspaceId)
                if (fetchedMatch) {
                    return {
                        workspaceId: fetchedMatch.workspace_id || workspaceId,
                        preferredProject: fetchedMatch,
                    }
                }
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
            // Org switch → entitlements must re-resolve from the new org's
            // subscription. Remove the cached subscription so consumers see a
            // pending state instead of the previous org's plan flags while
            // the new fetch is in flight.
            queryClient.removeQueries({queryKey: ["billing", "subscription"]})

            try {
                const {workspaceId, preferredProject} = await resolveWorkspaceForOrg(organizationId)
                if (!workspaceId) return

                const lastUsedProjectId = getLastUsedProjectId(workspaceId)
                if (organizationId) cacheWorkspaceOrgPair(workspaceId, organizationId)

                const projectId = lastUsedProjectId ?? preferredProject?.project_id
                const href = projectId
                    ? buildProjectSwitchHref({
                          workspaceId,
                          projectId,
                          currentAsPath: router.asPath,
                          settingsTab,
                          queryTab: router.query.tab,
                      })
                    : `/w/${encodeURIComponent(workspaceId)}`

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
            settingsTab,
            selectedOrgId,
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
        // Entitlements derive from /billing/subscription (org-keyed) and
        // /access/plans (deployment-wide). Invalidate both so consumers
        // (useEntitlements) re-resolve once the org refresh settles.
        await queryClient.invalidateQueries({queryKey: ["billing", "subscription"]})
        await queryClient.invalidateQueries({queryKey: ["access", "plans"]})
    }, [refetchOrgs, refetchSelectedOrg, queryClient])

    return {
        orgs,
        selectedOrg: selectedOrg ?? null,
        loading: loadingOrgs || loadingDetails,
        changeSelectedOrg,
        reset,
        refetch,
    }
}

export const useSelectedOrg = () => useAtomValue(selectedOrgAtom)
export const useOrgList = () => useAtomValue(orgsAtom)
