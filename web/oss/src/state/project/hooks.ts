import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"

import {projectsQueryAtom} from "./selectors/project"
import {projectAtom, projectsAtom, projectIdAtom} from "./selectors/project"

export const useProjectData = () => {
    const [{data: projects, isPending, isLoading, refetch}] = useAtom(projectsQueryAtom)
    const project = useAtomValue(projectAtom)
    const projectId = useAtomValue(projectIdAtom)
    const isProjectId = !!projectId
    const queryClient = useQueryClient()

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
