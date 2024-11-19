import {useSession} from "@/hooks/useSession"
import {PropsWithChildren, createContext, useState, useContext, useEffect, useCallback} from "react"
import {fetcAllhProjects} from "@/services/project"
import useStateCallback from "@/hooks/useStateCallback"

type Project = {
    workspace_id: string | null
    workspace_name: string | null
    project_id: string | null
    project_name: string | null
    user_role: string | null
}

type ProjectContextType = {
    project: Project | null
    isProjectId: boolean
    projectId: string
    isLoading: boolean
    reset: () => void
    refetch: (onSuccess?: () => void) => void
}

const initialValues: ProjectContextType = {
    project: null,
    isProjectId: false,
    projectId: "",
    isLoading: false,
    reset: () => {},
    refetch: () => {},
}

export const ProjectContext = createContext<ProjectContextType>(initialValues)

export const useProjectData = () => useContext(ProjectContext)

const projectContextValues = {...initialValues}

export const getProjectValues = () => projectContextValues

const ProjectContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [project, setProject] = useStateCallback<Project | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const {doesSessionExist} = useSession()

    const isProjectId = !isLoading && Boolean(project?.project_id)
    const projectId = project?.project_id as string

    const fetcher = useCallback(async (onSuccess?: () => void) => {
        try {
            const data = await fetcAllhProjects()
            setProject(data[0], onSuccess)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (doesSessionExist) {
            fetcher()
        }
    }, [doesSessionExist])

    const reset = () => {
        setProject(initialValues.project)
    }

    projectContextValues.project = project
    projectContextValues.isProjectId = isProjectId
    projectContextValues.projectId = projectId

    return (
        <ProjectContext.Provider
            value={{
                project,
                isProjectId,
                projectId,
                isLoading,
                reset,
                refetch: fetcher,
            }}
        >
            {children}
        </ProjectContext.Provider>
    )
}

export default ProjectContextProvider
