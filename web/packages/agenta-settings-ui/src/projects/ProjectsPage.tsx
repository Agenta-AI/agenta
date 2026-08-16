import {useCallback, useMemo, useState} from "react"

import {createProject, deleteProject, patchProject} from "@agenta/entities/project"
import type {ProjectsResponse} from "@agenta/entities/project"
import {useStaticTable} from "@agenta/settings"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components/presentational"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {Button, Input} from "@agenta/ui/ui"
import {CheckCircle, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"

/**
 * Mutation failures arrive either as an axios-style payload (`response.data.detail`) or as a
 * plain `Error`. `extractApiErrorMessage` reads both, but stringifies anything it cannot read —
 * so when that is all it found, show the per-action copy instead of `[object Object]`.
 */
const mutationErrorMessage = (error: unknown, fallback: string): string => {
    const detail = extractApiErrorMessage(error)
    return !detail || detail === String(error) ? fallback : detail
}

interface ProjectFormValues {
    name: string
    make_default?: boolean
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
        onError: (error: unknown) => {
            message.error(mutationErrorMessage(error, "Unable to create project"))
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
        onError: (error: unknown) => {
            message.error(mutationErrorMessage(error, "Unable to rename project"))
        },
    })

    const defaultMutation = useMutation({
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
        onSuccess: () => {
            message.success("Default project updated")
            void invalidateProjects()
        },
        onError: (error: unknown) => {
            message.error(mutationErrorMessage(error, "Unable to set default"))
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) => deleteProject(projectId),
        onSuccess: () => {
            message.success("Project deleted")
            void invalidateProjects()
        },
        onError: (error: unknown) => {
            message.error(mutationErrorMessage(error, "Unable to delete project"))
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

    const columns = useMemo(
        () =>
            createStandardColumns<ProjectRow>([
                {
                    type: "entity",
                    key: "project_name",
                    title: "Project",
                    width: 260,
                    fixed: "left",
                    getName: (record) => record.project_name,
                    getChips: (record) => (record.is_default_project ? [{label: "Default"}] : []),
                },
                // Its own column, not a second line under the name.
                {type: "slug", key: "project_id", title: "Project ID", width: 330},
                {
                    type: "text",
                    key: "user_role",
                    title: "Your role",
                    width: 140,
                    render: (_value, record) =>
                        record.user_role ? <Tag className="m-0" label={record.user_role} /> : "—",
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "rename",
                            label: "Rename",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: ProjectRow) => openRenameModal(record),
                        },
                        {
                            key: "default",
                            label: "Set as default",
                            icon: <CheckCircle size={16} />,
                            hidden: (record: ProjectRow) => Boolean(record.is_default_project),
                            disabled: () => defaultMutation.isPending,
                            onClick: (record: ProjectRow) => handleMakeDefault(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete project",
                            icon: <Trash size={16} />,
                            danger: true,
                            // The last project in a workspace cannot be removed, and the
                            // default project must be reassigned first.
                            disabled: (record: ProjectRow) =>
                                !canDeleteProjects || Boolean(record.is_default_project),
                            onClick: (record: ProjectRow) => handleDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<ProjectRow>,
            ]),
        [
            canDeleteProjects,
            defaultMutation.isPending,
            handleDelete,
            handleMakeDefault,
            openRenameModal,
        ],
    )

    const {tableScope, pagination} = useStaticTable<ProjectRow>("settings-projects", rows, {
        loading: isLoading,
    })
    return (
        <div className="flex flex-col gap-2">
            <InfiniteVirtualTableFeatureShell<ProjectRow>
                tableScope={tableScope}
                autoHeight={false}
                columns={columns}
                rowKey="key"
                pagination={pagination}
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
                    <Button onClick={() => setCreateModalOpen(true)} disabled={isLoading}>
                        <Plus size={14} />
                        New project
                    </Button>
                }
                tableProps={{
                    size: "small",
                    bordered: true,
                    tableLayout: "fixed",
                    locale: {
                        emptyText: searchTerm.trim() ? (
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
                                <Button variant="outline" onClick={() => setCreateModalOpen(true)}>
                                    <Plus size={14} />
                                    New project
                                </Button>
                            </EmptyState>
                        ),
                    },
                }}
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
