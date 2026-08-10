import {useCallback, useMemo, useState} from "react"

import {createProject, deleteProject, patchProject} from "@agenta/entities/project"
import type {ProjectsResponse} from "@agenta/entities/project"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components/presentational"
import {
    Button,
    DataTable,
    EmptyState,
    Input,
    type DataTableAction,
    type DataTableColumn,
} from "@agenta/ui/ui"
import {CheckCircle, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"

interface ProjectFormValues {
    name: string
    make_default?: boolean
}

/** Axios surfaces the backend's reason on `response.data.detail`. */
const errorDetail = (error: unknown, fallback: string): string => {
    const axiosLike = error as {response?: {data?: {detail?: string}}; message?: string}
    return axiosLike?.response?.data?.detail || axiosLike?.message || fallback
}

interface ProjectRow extends ProjectsResponse {
    key: string
    [extra: string]: unknown
}

export interface ProjectDialogState<T> {
    open: boolean
    onClose: () => void
    /** Run the mutation with the form's values. */
    onSubmit: (values: T) => void
    pending: boolean
    project?: ProjectsResponse | null
}

export interface ProjectsPageProps {
    projects: ProjectsResponse[]
    isLoading: boolean
    workspaceId?: string
    /** Create / rename / delete dialogs — antd-Form driven on the desktop, a sheet on mobile. */
    renderCreateDialog?: (state: ProjectDialogState<ProjectFormValues>) => React.ReactNode
    renderRenameDialog?: (state: ProjectDialogState<ProjectFormValues>) => React.ReactNode
    renderDeleteDialog?: (state: ProjectDialogState<void>) => React.ReactNode
}

export const ProjectsPage = ({
    projects,
    isLoading,
    workspaceId,
    renderCreateDialog,
    renderRenameDialog,
    renderDeleteDialog,
}: ProjectsPageProps) => {
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<ProjectsResponse | null>(null)
    const [activeProject, setActiveProject] = useState<ProjectsResponse | null>(null)
    const [searchTerm, setSearchTerm] = useState("")

    const scopedProjects = useMemo(() => {
        if (!projects) return []
        if (!workspaceId) return projects
        return projects.filter((project) => project.workspace_id === workspaceId)
    }, [projects, workspaceId])
    const canDeleteProjects = scopedProjects.length > 1
    // Create, rename and delete all need a dialog from the host. A host that brings none (mobile)
    // gets the list read-only rather than affordances that open nothing.
    const canEdit = Boolean(renderCreateDialog || renderRenameDialog || renderDeleteDialog)

    const rows = useMemo<ProjectRow[]>(() => {
        const all = scopedProjects.map((project) => ({...project, key: project.project_id}))
        const term = searchTerm.trim().toLowerCase()
        if (!term) return all
        return all.filter((project) =>
            [project.project_name, project.project_id].some((value) =>
                value?.toLowerCase().includes(term),
            ),
        )
    }, [scopedProjects, searchTerm])

    const invalidateProjects = useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["projects"]})
    }, [queryClient])

    const createMutation = useMutation({
        mutationFn: (payload: ProjectFormValues) => createProject(payload),
        onSuccess: () => {
            message.success("Project created")
            void invalidateProjects()
            setCreateModalOpen(false)
        },
        onError: (error) => {
            message.error(errorDetail(error, "Unable to create project"))
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({projectId, name}: {projectId: string; name: string}) =>
            patchProject(projectId, {name}),
        onSuccess: () => {
            message.success("Project renamed")
            void invalidateProjects()
            setRenameModalOpen(false)
            setActiveProject(null)
        },
        onError: (error) => {
            message.error(errorDetail(error, "Unable to rename project"))
        },
    })

    const defaultMutation = useMutation({
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
        onSuccess: () => {
            message.success("Default project updated")
            void invalidateProjects()
        },
        onError: (error) => {
            message.error(errorDetail(error, "Unable to set default"))
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) => deleteProject(projectId),
        onSuccess: () => {
            message.success("Project deleted")
            void invalidateProjects()
        },
        onError: (error) => {
            message.error(errorDetail(error, "Unable to delete project"))
        },
    })

    const handleCreate = useCallback(
        (values: ProjectFormValues) => {
            createMutation.mutate({
                name: values.name.trim(),
                make_default: values.make_default,
            })
        },
        [createMutation],
    )

    const handleRename = useCallback(
        (values: ProjectFormValues) => {
            if (!activeProject) return
            renameMutation.mutate({
                projectId: activeProject.project_id,
                name: values.name.trim(),
            })
        },
        [activeProject, renameMutation],
    )

    const handleMakeDefault = useCallback(
        (project: ProjectsResponse) => {
            if (!project?.project_id) return
            defaultMutation.mutate(project.project_id)
        },
        [defaultMutation],
    )

    const handleDelete = useCallback(
        (project: ProjectsResponse) => {
            if (!canDeleteProjects) return
            setProjectToDelete(project)
        },
        [canDeleteProjects],
    )

    const openRenameModal = useCallback((project: ProjectsResponse) => {
        setActiveProject(project)
        setRenameModalOpen(true)
    }, [])

    const columns = useMemo<DataTableColumn<ProjectRow>[]>(
        () => [
            {
                key: "project_name",
                title: "Project",
                width: 260,
                render: (record) => (
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{record.project_name}</span>
                        {record.is_default_project ? <Tag className="m-0" label="Default" /> : null}
                    </div>
                ),
            },
            // Its own column, not a second line under the name.
            {
                key: "project_id",
                title: "Project ID",
                width: 330,
                mono: true,
                render: (r) => r.project_id,
            },
            {
                key: "user_role",
                title: "Your role",
                width: 140,
                render: (record) =>
                    record.user_role ? <Tag className="m-0" label={record.user_role} /> : "—",
            },
        ],
        [],
    )

    const rowActions = useCallback(
        (record: ProjectRow): (DataTableAction<ProjectRow> | {type: "divider"})[] => [
            {
                key: "rename",
                label: "Rename",
                icon: <PencilSimpleLine size={16} />,
                onClick: () => openRenameModal(record),
            },
            {
                key: "default",
                label: "Set as default",
                icon: <CheckCircle size={16} />,
                hidden: Boolean(record.is_default_project),
                disabled: defaultMutation.isPending,
                onClick: () => handleMakeDefault(record),
            },
            {type: "divider"},
            {
                key: "delete",
                label: "Delete project",
                icon: <Trash size={16} />,
                danger: true,
                // The last project in a workspace cannot be removed, and the default project
                // must be reassigned first.
                disabled: !canDeleteProjects || Boolean(record.is_default_project),
                onClick: () => handleDelete(record),
            },
        ],
        [
            canDeleteProjects,
            defaultMutation.isPending,
            handleDelete,
            handleMakeDefault,
            openRenameModal,
        ],
    )

    return (
        <div className="flex flex-col gap-2">
            <DataTable<ProjectRow>
                columns={columns}
                rows={rows}
                rowKey={(record) => record.key}
                loading={isLoading}
                actions={canEdit ? rowActions : undefined}
                filters={
                    <Input
                        placeholder="Search projects"
                        className="w-[260px]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        disabled={isLoading}
                    />
                }
                primaryActions={
                    canEdit ? (
                        <Button onClick={() => setCreateModalOpen(true)} disabled={isLoading}>
                            <Plus size={14} />
                            New project
                        </Button>
                    ) : null
                }
                empty={
                    searchTerm.trim() ? (
                        <EmptyState
                            image="simple"
                            description={`No projects match “${searchTerm.trim()}”`}
                        />
                    ) : (
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No projects in this workspace yet
                                    </span>
                                    <span>
                                        Create a project to organize your agents, datasets, and
                                        deployments.
                                    </span>
                                </div>
                            }
                        >
                            {canEdit ? (
                                <Button variant="outline" onClick={() => setCreateModalOpen(true)}>
                                    <Plus size={14} />
                                    New project
                                </Button>
                            ) : null}
                        </EmptyState>
                    )
                }
            />

            {renderCreateDialog?.({
                open: isCreateModalOpen,
                onClose: () => setCreateModalOpen(false),
                onSubmit: handleCreate,
                pending: createMutation.isPending,
            })}

            {renderRenameDialog?.({
                open: isRenameModalOpen,
                onClose: () => {
                    setRenameModalOpen(false)
                    setActiveProject(null)
                },
                onSubmit: handleRename,
                pending: renameMutation.isPending,
                project: activeProject,
            })}

            {renderDeleteDialog?.({
                open: Boolean(projectToDelete),
                onClose: () => setProjectToDelete(null),
                onSubmit: () => {
                    if (!projectToDelete) return
                    deleteMutation.mutate(projectToDelete.project_id)
                    setProjectToDelete(null)
                },
                pending: deleteMutation.isPending,
                project: projectToDelete,
            })}
        </div>
    )
}
