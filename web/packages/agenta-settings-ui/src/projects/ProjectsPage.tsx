import {useCallback, useMemo, useState} from "react"

import {createProject, deleteProject, patchProject} from "@agenta/entities/project"
import type {ProjectsResponse} from "@agenta/entities/project"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Copy, FolderSimple, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {InlineName} from "../shared/InlineName"
import {NameAvatar} from "../shared/NameAvatar"
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
    {key: "project_name", label: "Project", width: "minmax(0,2fr)"},
    {key: "status", label: "Status", width: "minmax(0,1fr)"},
    {key: "user_role", label: "Your role", width: "minmax(0,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
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
    /** The project the reader is in now, marked Current. */
    currentProjectId?: string
    /** Create / delete dialogs — the host's. Rename happens in place on the row. */
    renderCreateDialog?: (state: ProjectDialogState<ProjectFormValues>) => React.ReactNode
    renderDeleteDialog?: (state: ProjectDialogState<void>) => React.ReactNode
}

export const ProjectsPage = ({
    projects,
    isLoading,
    workspaceId,
    currentProjectId,
    renderCreateDialog,
    renderDeleteDialog,
}: ProjectsPageProps) => {
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<ProjectsResponse | null>(null)
    const [renamingId, setRenamingId] = useState<string | null>(null)

    const scopedProjects = useMemo(() => {
        if (!projects) return []
        if (!workspaceId) return projects
        return projects.filter((project) => project.workspace_id === workspaceId)
    }, [projects, workspaceId])
    const canDeleteProjects = scopedProjects.length > 1
    // A host that brings no dialogs gets the list read-only rather than affordances that open nothing.
    const canEdit = Boolean(renderCreateDialog || renderDeleteDialog)

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
            void invalidateProjects()
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

    const handleDelete = useCallback(
        (project: ProjectsResponse) => {
            if (!canDeleteProjects) return
            setProjectToDelete(project)
        },
        [canDeleteProjects],
    )

    const newProject = canEdit ? (
        <Button onClick={() => setCreateModalOpen(true)} disabled={isLoading}>
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
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={0}
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
                            <NameAvatar name={record.project_name} />
                            <InlineName
                                value={record.project_name}
                                editing={canEdit && renamingId === record.project_id}
                                ariaLabel="Project name"
                                onStart={
                                    canEdit ? () => setRenamingId(record.project_id) : undefined
                                }
                                onDone={() => setRenamingId(null)}
                                onSave={(name) =>
                                    renameMutation
                                        .mutateAsync({projectId: record.project_id, name})
                                        .catch((error) => {
                                            throw new Error(
                                                errorDetail(error, "Unable to rename project"),
                                            )
                                        })
                                }
                            />
                            {record.is_default_project ? (
                                <Tag className="m-0 shrink-0" label="Default" />
                            ) : null}
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                            {record.project_id === currentProjectId ? (
                                <StatusIndicator
                                    tone="success"
                                    label="Current"
                                    className="text-[13px]"
                                />
                            ) : record.is_demo ? (
                                <Tag className="m-0" label="Demo" />
                            ) : (
                                <span className="text-muted-foreground">—</span>
                            )}
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
                                    hidden: !canEdit,
                                    deferred: true,
                                    onClick: () => setRenamingId(record.project_id),
                                },
                                {
                                    key: "copy-id",
                                    label: "Copy project ID",
                                    icon: <Copy size={14} />,
                                    onClick: () =>
                                        void navigator.clipboard?.writeText(record.project_id).then(
                                            () => message.success("Project ID copied"),
                                            () => message.error("Couldn't copy the project ID"),
                                        ),
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
