import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"

import {OrgDetails} from "@/oss/lib/Types"
import {fetchSingleOrg} from "@/oss/services/organization/api"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {requestNavigationAtom} from "@/oss/state/appState"

import {projectsAtom} from "../project/selectors/project"

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

export const useOrgData = () => {
    const queryClient = useQueryClient()
    const [{data: orgs, isPending: loadingOrgs, refetch: refetchOrgs}] = useAtom(orgsQueryAtom)
    const [{data: selectedOrg, isPending: loadingDetails, refetch: refetchSelectedOrg}] =
        useAtom(selectedOrgQueryAtom)
    const navigate = useSetAtom(requestNavigationAtom)
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)

    const projects = useAtomValue(projectsAtom)

    const resolveWorkspaceForOrg = useCallback(
        async (
            orgId: string,
        ): Promise<{workspaceId: string | null; preferredProject: ProjectsResponse | null}> => {
            const matchingProject = projects.find((project) =>
                projectMatchesWorkspace(project, orgId),
            )

            if (matchingProject) {
                return {
                    workspaceId: matchingProject.workspace_id || orgId,
                    preferredProject: matchingProject,
                }
            }

            const cachedDetails = queryClient.getQueryData<OrgDetails | null>([
                "selectedOrg",
                orgId,
            ])

            const resolvedDetails =
                cachedDetails ??
                (await queryClient.fetchQuery({
                    queryKey: ["selectedOrg", orgId],
                    queryFn: () => fetchSingleOrg({orgId}),
                }))

            const workspaceId = resolvedDetails?.default_workspace?.id ?? orgId

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
        async (orgId: string, onSuccess?: () => void) => {
            if (loadingOrgs) return
            if (!orgId) {
                navigate({type: "href", href: "/w", method: "replace"})
                return
            }

            if (orgId === selectedOrgId) {
                onSuccess?.()
                return
            }

            queryClient.removeQueries({queryKey: ["selectedOrg", selectedOrgId]})

            try {
                const {workspaceId, preferredProject} = await resolveWorkspaceForOrg(orgId)
                if (!workspaceId) return

                if (preferredProject?.organization_id) {
                    cacheWorkspaceOrgPair(
                        preferredProject.workspace_id ?? workspaceId,
                        preferredProject.organization_id,
                    )
                }

                const href = preferredProject
                    ? `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(preferredProject.project_id)}/apps`
                    : `/w/${encodeURIComponent(workspaceId)}`

                navigate({type: "href", href, method: "push", shallow: false})
                onSuccess?.()
            } catch (error) {
                console.error("Failed to change workspace:", error)
            }
        },
        [loadingOrgs, navigate, queryClient, resolveWorkspaceForOrg, selectedOrgId],
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
