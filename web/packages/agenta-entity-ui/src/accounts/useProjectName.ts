import {fetchProject} from "@agenta/entities/project"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** The current project's name, for "Everyone in <project>". Read only while `enabled`. */
export const useProjectName = (enabled: boolean): string | undefined => {
    const projectId = useAtomValue(projectIdAtom)
    const {data} = useQuery({
        queryKey: ["projects", "detail", projectId],
        queryFn: () => fetchProject(projectId as string),
        enabled: enabled && Boolean(projectId),
        staleTime: 60_000,
    })
    return data?.project_name
}
