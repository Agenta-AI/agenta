import {useCallback, useMemo, useState} from "react"

import {createProject, deleteProject, patchProject} from "@agenta/entities/project"
import type {ProjectsResponse} from "@agenta/entities/project"
import {useT} from "@agenta/i18n/settings"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {
    ArrowsLeftRight,
    CheckCircle,
    Copy,
    PencilSimpleLine,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"

import {SettingsPageActions} from "../SettingsPageShell"
import {copyWithMessage} from "../shared/copyWithMessage"
import {hoverableRow} from "../shared/hoverableRow"
import {InlineName} from "../shared/InlineName"
import {NameAvatar} from "../shared/NameAvatar"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

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

const columnsFor = (t: ReturnType<typeof useT>): ListTableColumn[] => [
    {key: "project_name", label: t("settings.projects.project"), width: "minmax(0,2fr)"},
    {key: "status", label: t("common.status"), width: "minmax(0,1fr)"},
    {key: "user_role", label: t("common.yourRole"), width: "minmax(0,1fr)"},
    {key: "actions", label: t("common.actions"), srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["project_name", "status", "actions"]

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
    /** Move into another project; the row click and a menu item both call it. */
    onSwitch?: (project: ProjectsResponse) => void
    /** Create / delete dialogs — the host's. Rename happens in place on the row. */
    renderCreateDialog?: (state: ProjectDialogState<ProjectFormValues>) => React.ReactNode
    renderDeleteDialog?: (state: ProjectDialogState<void>) => React.ReactNode
    /** Whether the reader may create a project. Defaults to "yes wherever a dialog exists". */
    canCreate?: boolean
    /** Whether the reader may rename a project. Same default. */
    canEdit?: boolean
    /** Whether the reader may make a project the default. Defaults to `canEdit`. */
    canSetDefault?: boolean
    /** Whether the reader may delete a project. Same default; the API allows the owner only. */
    canDelete?: boolean
    /**
     * After a create, rename, set-default or delete lands, for a host that caches projects
     * elsewhere.
     */
    onChanged?: () => void
}

export const ProjectsPage = ({
    projects,
    isLoading,
    workspaceId,
    currentProjectId,
    onSwitch,
    renderCreateDialog,
    renderDeleteDialog,
    canCreate,
    canEdit: canEditProp,
    canSetDefault: canSetDefaultProp,
    canDelete,
    onChanged,
}: ProjectsPageProps) => {
    const t = useT()
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<ProjectsResponse | null>(null)
    const [renamingId, setRenamingId] = useState<string | null>(null)

    const scopedProjects = useMemo(() => {
        if (!projects) return []
        if (!workspaceId) return projects
        // The segment is the organization id (workspace removal step 2) or a legacy
        // workspace id: an API pod of either version answers the same projects.
        return projects.filter(
            (project) =>
                project.workspace_id === workspaceId || project.organization_id === workspaceId,
        )
    }, [projects, workspaceId])
    // A host that brings no dialogs gets the list read-only rather than affordances that open
    // nothing. A host that knows the reader's reach says so, and each verb follows its own flag.
    const hasDialogs = Boolean(renderCreateDialog || renderDeleteDialog)
    const canEdit = canEditProp ?? hasDialogs
    const canSetDefault = canSetDefaultProp ?? canEdit
    const showCreate = (canCreate ?? hasDialogs) && Boolean(renderCreateDialog)
    const showDelete = (canDelete ?? hasDialogs) && Boolean(renderDeleteDialog)
    const canDeleteProjects = scopedProjects.length > 1

    const {columns, shows} = usePhoneColumns(
        useMemo(() => columnsFor(t), [t]),
        PHONE_KEYS,
    )

    const rows = useMemo<ProjectRow[]>(() => {
        return scopedProjects.map((project) => ({...project, key: project.project_id}))
    }, [scopedProjects])

    const invalidateProjects = useCallback(async () => {
        onChanged?.()
        await queryClient.invalidateQueries({queryKey: ["projects"]})
    }, [queryClient, onChanged])

    const createMutation = useMutation({
        // The workspace on the page, not the caller's default: without it the API creates
        // the project in the caller's default (often personal) organization.
        mutationFn: (payload: ProjectFormValues) => createProject(payload, workspaceId),
        onSuccess: () => {
            message.success(t("settings.projects.created"))
            void invalidateProjects()
            setCreateModalOpen(false)
        },
        onError: (error) => {
            message.error(errorDetail(error, t("settings.projects.createFailed")))
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({projectId, name}: {projectId: string; name: string}) =>
            patchProject(projectId, {name}),
        onSuccess: () => {
            void invalidateProjects()
        },
    })

    const defaultMutation = useMutation({
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
        onSuccess: () => {
            message.success(t("settings.projects.defaultUpdated"))
            void invalidateProjects()
        },
        onError: (error) => {
            message.error(errorDetail(error, t("settings.projects.setDefaultFailed")))
        },
    })

    const deleteMutation = useMutation({
        // The delete route checks the project against the request's workspace; without one it
        // uses the caller's default workspace and answers 404 for any other organization.
        mutationFn: (project: ProjectsResponse) =>
            deleteProject(project.project_id, project.workspace_id ?? workspaceId),
        onSuccess: () => {
            message.success(t("settings.projects.deleted"))
            void invalidateProjects()
        },
        onError: (error) => {
            message.error(errorDetail(error, t("settings.projects.deleteFailed")))
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

    const newProject = showCreate ? (
        <Button onClick={() => setCreateModalOpen(true)} disabled={isLoading}>
            <Plus size={14} />
            {t("settings.projects.newProject")}
        </Button>
    ) : null

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{newProject}</SettingsPageActions>
            <ListTable<ProjectRow>
                columns={columns}
                groups={[{key: "projects", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={0}
                density="compact"
                onOpenRow={
                    onSwitch
                        ? (record) => {
                              if (record.project_id !== currentProjectId) onSwitch(record)
                          }
                        : undefined
                }
                loading={isLoading && rows.length === 0}
                hideHeader={!isLoading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("projects")}
                        title={t("settings.projects.emptyTitle")}
                        description={t("settings.projects.emptyDescription")}
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
                                ariaLabel={t("settings.projects.projectName")}
                                onDone={() => setRenamingId(null)}
                                onSave={(name) =>
                                    renameMutation
                                        .mutateAsync({projectId: record.project_id, name})
                                        .catch((error) => {
                                            throw new Error(
                                                errorDetail(
                                                    error,
                                                    t("settings.projects.renameFailed"),
                                                ),
                                            )
                                        })
                                }
                            />
                            {record.is_default_project ? (
                                <Tag
                                    className="m-0 shrink-0"
                                    label={t("settings.projects.default")}
                                />
                            ) : null}
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                            {record.project_id === currentProjectId ? (
                                <StatusIndicator
                                    tone="success"
                                    label={t("settings.projects.current")}
                                    className="text-[13px]"
                                />
                            ) : (
                                <span className="text-muted-foreground">—</span>
                            )}
                        </span>
                        {shows("user_role") ? (
                            <span className="flex min-w-0">
                                {record.user_role ? (
                                    <Tag className="m-0" label={record.user_role} />
                                ) : (
                                    <span className="text-muted-foreground">—</span>
                                )}
                            </span>
                        ) : null}
                        <SettingsRowMenu
                            label={t("settings.projects.projectActions")}
                            items={[
                                {
                                    key: "switch",
                                    label: t("settings.projects.switchTo"),
                                    icon: <ArrowsLeftRight size={14} />,
                                    hidden: !onSwitch || record.project_id === currentProjectId,
                                    onClick: () => onSwitch?.(record),
                                },
                                {
                                    key: "rename",
                                    label: t("common.rename"),
                                    icon: <PencilSimpleLine size={14} />,
                                    hidden: !canEdit,
                                    deferred: true,
                                    onClick: () => setRenamingId(record.project_id),
                                },
                                {
                                    key: "copy-id",
                                    label: t("settings.projects.copyId"),
                                    icon: <Copy size={14} />,
                                    onClick: () =>
                                        void copyWithMessage(
                                            record.project_id,
                                            t("settings.projects.idCopied"),
                                            t("settings.projects.copyIdFailed"),
                                        ),
                                },
                                {
                                    key: "default",
                                    label: t("settings.projects.setAsDefault"),
                                    icon: <CheckCircle size={14} />,
                                    hidden: !canSetDefault || Boolean(record.is_default_project),
                                    disabled: defaultMutation.isPending,
                                    onClick: () => defaultMutation.mutate(record.project_id),
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: t("settings.projects.deleteProject"),
                                    icon: <Trash size={14} />,
                                    danger: true,
                                    hidden: !showDelete,
                                    // The last project and the default project cannot be deleted.
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
                    deleteMutation.mutate(projectToDelete)
                    setProjectToDelete(null)
                },
                pending: deleteMutation.isPending,
                project: projectToDelete,
            })}
        </section>
    )
}
