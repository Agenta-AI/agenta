export * from "./selectors/project"
export * from "./hooks"

import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {ProjectsResponse} from "@/oss/services/project/types"

import {getOrgValues} from "../org"

import {projectAtom, projectIdAtom} from "./selectors/project"

export const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000"

export const getProjectValues = () => {
    const store = getDefaultStore()
    const queryClient = store.get(queryClientAtom)
    const {selectedOrg} = getOrgValues()
    const orgId = selectedOrg?.id

    const queryKey = ["projects", orgId]
    const queryData = queryClient.getQueryData<ProjectsResponse[]>(queryKey)
    const queryState = queryClient.getQueryState(queryKey)

    const projects: ProjectsResponse[] = queryData ?? []
    const project = store.get(projectAtom)

    const projectId = store.get(projectIdAtom)
    const isProjectId = !!projectId && projectId !== DEFAULT_UUID

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
    const queryClient = store.get(queryClientAtom)
    queryClient.removeQueries({queryKey: ["projects"]})
    store.set(projectIdAtom, null)
}
