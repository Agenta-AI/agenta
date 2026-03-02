import {useCallback, useEffect} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {projectsQueryAtom} from "./selectors/project"
import {
    cacheLastUsedProjectId,
    lastNonDemoProjectAtom,
    projectAtom,
    projectIdAtom,
    projectsAtom,
} from "./selectors/project"

export const useProjectData = () => {
    const [{data: projects, isPending: _isPending, isLoading, refetch: _refetch}] =
        useAtom(projectsQueryAtom)
    const project = useAtomValue(projectAtom)
    const projectId = useAtomValue(projectIdAtom)
    const isProjectId = !!projectId
    const queryClient = useQueryClient()
    const setLastNonDemoProject = useSetAtom(lastNonDemoProjectAtom)

    useEffect(() => {
        if (!project?.project_id) return
        const workspaceKey = project.workspace_id || project.organization_id || null
        cacheLastUsedProjectId(workspaceKey, project.project_id)
        if (!project.is_demo && workspaceKey) {
            setLastNonDemoProject({
                workspaceId: workspaceKey,
                projectId: project.project_id,
                organizationId: project.organization_id ?? null,
            })
        }
    }, [
        project?.organization_id,
        project?.project_id,
        project?.workspace_id,
        project?.is_demo,
        setLastNonDemoProject,
    ])

    const reset = useCallback(async () => {
        return await queryClient.removeQueries({queryKey: ["projects"]})
    }, [queryClient])

    const invalidate = useCallback(async () => {
        return await queryClient.invalidateQueries({queryKey: ["projects"]})
    }, [queryClient])

    return {
        project: project ?? null,
        projects: projects ?? [],
        isProjectId,
        projectId,
        // isLoading: isPending,
        isLoading: isLoading,
        reset,
        refetch: invalidate,
    }
}

export const useProject = () => useAtomValue(projectAtom)
export const useProjectList = () => useAtomValue(projectsAtom)
