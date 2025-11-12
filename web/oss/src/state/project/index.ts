export * from "./selectors/project"
export * from "./hooks"

import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {ProjectsResponse} from "@/oss/services/project/types"

import {getOrganizationValues} from "../organization"

import {projectAtom, projectIdAtom, resetProjectDataAtom} from "./selectors/project"

export const getProjectValues = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    const {selectedOrganization} = getOrganizationValues()
    const organizationId = selectedOrganization?.id

    const queryKey = ["projects", organizationId]
    const queryData = queryClient.getQueryData<ProjectsResponse[]>(queryKey)
    const queryState = queryClient.getQueryState(queryKey)

    const projects: ProjectsResponse[] = queryData ?? []
    const project = store.get(projectAtom)

    const projectId = store.get(projectIdAtom)
    const isProjectId = !!projectId

    const isLoading = queryState?.status === "pending"
    return {
        project,
        projects,
        projectId,
        isProjectId: !isLoading && isProjectId,
        isLoading,
    }
}

export const resetProjectData = () => {
    const store = getDefaultStore()
    store.set(resetProjectDataAtom, null)
}
