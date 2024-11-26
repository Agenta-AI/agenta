import {useSession} from "@/hooks/useSession"
import {PropsWithChildren, createContext, useState, useContext, useEffect, useCallback} from "react"
import {fetchAllProjects} from "@/services/project"
import useStateCallback from "@/hooks/useStateCallback"
import {dynamicContext} from "@/lib/helpers/dynamic"
import {isDemo} from "@/lib/helpers/utils"

export const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000"

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

export const getCurrentProject = () => projectContextValues

const ProjectContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [project, setProject] = useStateCallback<Project | null>(null)
    const [useOrgData, setUseOrgData] = useState<Function>(() => () => "")
    const [isLoading, setIsLoading] = useState(true)
    const {doesSessionExist} = useSession()

    useEffect(() => {
        dynamicContext("org.context", {useOrgData}).then((context) => {
            setUseOrgData(() => context.useOrgData)
        })
    }, [])

    const {selectedOrg} = useOrgData()

    const workspaceId: string = selectedOrg?.default_workspace.id || DEFAULT_UUID

    const isProjectId = !isLoading && !!project?.project_id
    const projectId = (project?.project_id as string) || DEFAULT_UUID

    const fetcher = async (onSuccess?: () => void) => {
        setIsLoading(true)
        try {
            const data = await fetchAllProjects()

            const _project = isDemo()
                ? data.find((p: {workspace_id: string}) => p.workspace_id === workspaceId)
                : data[0]

            setProject(_project, onSuccess)
        } catch (error) {
            console.error(error)
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
    projectContextValues.isLoading = isLoading
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
            {isProjectId ? children : null}
        </ProjectContext.Provider>
    )
}

export default ProjectContextProvider
