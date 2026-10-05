import {useCallback, useMemo, useState} from "react"

import {createProject, deleteProject, patchProject} from "@agenta/entities/project"
import type {ProjectsResponse} from "@agenta/entities/project"
import {message} from "@agenta/ui/app-message"
import {InitialsAvatar, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {CheckCircle, FolderSimple, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {SettingsPageActions} from "../SettingsPageShell"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

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
}

const COLUMNS: ListTableColumn[] = [
    {key: "project_name", label: "Project", width: "minmax(200px,2fr)"},
    {key: "project_id", label: "Project ID", width: "minmax(240px,2fr)"},
    {key: "user_role", label: "Your role", width: "minmax(96px,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

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
        return scopedProjects.map((project) => ({...project, key: project.project_id}))
    }, [scopedProjects])

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

    const newProject = canEdit ? (
        <Button size="sm" onClick={() => setCreateModalOpen(true)} disabled={isLoading}>
            <Plus size={14} />
            New project
        </Button>
    ) : null

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{newProject}</SettingsPageActions>
            <ListTable<ProjectRow>
                columns={COLUMNS}
                groups={[{key: "projects", label: null, rows}]}
                rowKey={(record) => record.key}
                minWidth={640}
                loading={isLoading && rows.length === 0}
                hideHeader={!isLoading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={<FolderSimple size={18} />}
                        title="No projects in this workspace yet"
                        description="Create a project to organize your agents, datasets, and deployments."
                        action={newProject}
                    />
                }
                renderRow={(record) => (
                    <>
                        <span className="flex min-w-0 items-center gap-2.5">
                            {/* The identity column carries an avatar on every other settings
                                table; the extraction dropped it here and on Organizations. */}
                            <InitialsAvatar name={record.project_name} />
                            <span
                                className="truncate font-medium text-foreground"
                                title={record.project_name}
                            >
                                {record.project_name}
                            </span>
                            {record.is_default_project ? (
                                <Tag className="m-0 shrink-0" label="Default" />
                            ) : null}
                        </span>
                        <span className="truncate font-mono text-[13px] text-muted-foreground">
                            {record.project_id}
                        </span>
                        <span className="flex min-w-0">
                            {record.user_role ? (
                                <Tag className="m-0" label={record.user_role} />
                            ) : (
                                <span className="text-muted-foreground">—</span>
                            )}
                        </span>
                        <SettingsRowMenu
                            label="Project actions"
                            items={[
                                {
                                    key: "rename",
                                    label: "Rename",
                                    icon: <PencilSimpleLine size={14} />,
                                    onClick: () => openRenameModal(record),
                                },
                                {
                                    key: "default",
                                    label: "Set as default",
                                    icon: <CheckCircle size={14} />,
                                    hidden: Boolean(record.is_default_project),
                                    disabled: defaultMutation.isPending,
                                    onClick: () => handleMakeDefault(record),
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: "Delete project",
                                    icon: <Trash size={14} />,
                                    danger: true,
                                    // The last project in a workspace cannot be removed, and the
                                    // default project must be reassigned first.
                                    disabled:
                                        !canDeleteProjects || Boolean(record.is_default_project),
                                    onClick: () => handleDelete(record),
                                },
                            ]}
                        />
                    </>
                )}
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
        </section>
    )
}
