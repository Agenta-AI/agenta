import {useSession} from "@/hooks/useSession"
import {PropsWithChildren, createContext, useState, useContext, useEffect} from "react"
import {fetchAllProjects} from "@/services/project"
import useStateCallback from "@/hooks/useStateCallback"
import {isDemo} from "@/lib/helpers/utils"
import {ProjectsResponse} from "@/services/project/types"
import {useOrgData} from "./org.context"

export const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000"

type ProjectContextType = {
    project: ProjectsResponse | null
    projects: ProjectsResponse[]
    isProjectId: boolean
    projectId: string
    isLoading: boolean
    reset: () => void
    refetch: (onSuccess?: () => void) => void
}

const initialValues: ProjectContextType = {
    project: null,
    projects: [],
    isProjectId: false,
    projectId: "",
    isLoading: false,
    reset: () => {},
    refetch: () => {},
}

export const ProjectContext = createContext<ProjectContextType>(initialValues)

export const useProjectData = () => useContext(ProjectContext)

const projectContextValues = {...initialValues}

export const getCurrentProject = () => projectContextValues

const ProjectContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [project, setProject] = useStateCallback<ProjectsResponse | null>(null)
    const [projects, setProjects] = useState<ProjectsResponse[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const {doesSessionExist} = useSession()

    const {selectedOrg} = useOrgData()

    const workspaceId: string = selectedOrg?.default_workspace.id || DEFAULT_UUID

    const isProjectId = !isLoading && !!project?.project_id
    const projectId = (project?.project_id as string) || DEFAULT_UUID

    const fetcher = async (onSuccess?: () => void) => {
        setIsLoading(true)
        try {
            const data = await fetchAllProjects()

            const _project = isDemo()
                ? data.find((p) => p.workspace_id === workspaceId) || null
                : data[0] || null

            setProject(_project, onSuccess)
            setProjects(data)
        } catch (error) {
            console.error(error)
            setProject(null)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (doesSessionExist) {
            fetcher()
        }
    }, [doesSessionExist, selectedOrg])

    const reset = () => {
        setProject(initialValues.project)
    }

    projectContextValues.project = project
    projectContextValues.projects = projects
    projectContextValues.isLoading = isLoading
    projectContextValues.isProjectId = isProjectId
    projectContextValues.projectId = projectId

    return (
        <ProjectContext.Provider
            value={{
                project,
                projects,
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
