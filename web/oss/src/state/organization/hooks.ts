import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useSetAtom, useAtomValue} from "jotai"

import {OrganizationDetails} from "@/oss/lib/Types"
import {fetchSingleOrganization} from "@/oss/services/organization/api"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {requestNavigationAtom} from "@/oss/state/appState"

import {projectsAtom} from "../project/selectors/project"

import {
    cacheWorkspaceOrganizationPair,
    organizationsQueryAtom,
    selectedOrganizationQueryAtom,
    selectedOrganizationIdAtom,
    organizationsAtom,
    selectedOrganizationAtom,
} from "./selectors/organization"

const EmptyOrganizations: OrganizationDetails[] = []

const projectMatchesWorkspace = (
    project: {workspace_id?: string | null; organization_id?: string | null},
    workspaceId: string,
) => {
    if (!workspaceId) return false
    if (project.workspace_id && project.workspace_id === workspaceId) return true
    if (project.organization_id && project.organization_id === workspaceId) return true
    return false
}

export const useOrganizationData = () => {
    const queryClient = useQueryClient()
    const [{data: organizations, isPending: loadingOrganizations, refetch: refetchOrganizations}] = useAtom(organizationsQueryAtom)
    const [{data: selectedOrganization, isPending: loadingDetails, refetch: refetchSelectedOrganization}] =
        useAtom(selectedOrganizationQueryAtom)
    const navigate = useSetAtom(requestNavigationAtom)
    const selectedOrganizationId = useAtomValue(selectedOrganizationIdAtom)

    const projects = useAtomValue(projectsAtom)

    const resolveWorkspaceForOrganization = useCallback(
        async (
            organizationId: string,
        ): Promise<{workspaceId: string | null; preferredProject: ProjectsResponse | null}> => {
            const matchingProject = projects.find((project) =>
                projectMatchesWorkspace(project, organizationId),
            )

            if (matchingProject) {
                return {
                    workspaceId: matchingProject.workspace_id || organizationId,
                    preferredProject: matchingProject,
                }
            }

            const cachedDetails = queryClient.getQueryData<OrganizationDetails | null>([
                "selectedOrganization",
                organizationId,
            ])

            const resolvedDetails =
                cachedDetails ??
                (await queryClient.fetchQuery({
                    queryKey: ["selectedOrganization", organizationId],
                    queryFn: () => fetchSingleOrganization({organizationId}),
                }))

            const workspaceId = resolvedDetails?.default_workspace?.id ?? organizationId

            if (resolvedDetails?.default_workspace?.id) {
                cacheWorkspaceOrganizationPair(resolvedDetails.default_workspace.id, resolvedDetails.id)
            }

            return {
                workspaceId,
                preferredProject: null,
            }
        },
        [projects, queryClient],
    )

    const changeSelectedOrganization = useCallback(
        async (organizationId: string, onSuccess?: () => void) => {
            if (loadingOrganizations) return
            if (!organizationId) {
                navigate({type: "href", href: "/w", method: "replace"})
                return
            }

            if (organizationId === selectedOrganizationId) {
                onSuccess?.()
                return
            }

            queryClient.removeQueries({queryKey: ["selectedOrganization", selectedOrganizationId]})

            try {
                const {workspaceId, preferredProject} = await resolveWorkspaceForOrganization(organizationId)
                if (!workspaceId) return

                if (preferredProject?.organization_id) {
                    cacheWorkspaceOrganizationPair(
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
        [loadingOrganizations, navigate, queryClient, resolveWorkspaceForOrganization, selectedOrganizationId],
    )

    const reset = useCallback(async () => {
        await queryClient.removeQueries({queryKey: ["organizations"]})
        await queryClient.removeQueries({queryKey: ["selectedOrganization"]})
        navigate({type: "href", href: "/w", method: "replace"})
    }, [navigate, queryClient])

    const refetch = useCallback(async () => {
        await refetchOrganizations()
        await refetchSelectedOrganization()
    }, [refetchOrganizations, refetchSelectedOrganization])

    return {
        organizations: organizations ?? EmptyOrganizations,
        selectedOrganization: selectedOrganization ?? null,
        loading: loadingOrganizations || loadingDetails,
        changeSelectedOrganization,
        reset,
        refetch,
    }
}

export const useSelectedOrganization = () => useAtomValue(selectedOrganizationAtom)
export const useOrganizationList = () => useAtomValue(organizationsAtom)
