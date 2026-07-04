import {useCallback, useMemo, useState} from "react"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@agenta/primitive-ui/components/alert-dialog"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Empty, EmptyDescription, EmptyHeader} from "@agenta/primitive-ui/components/empty"
import {Form, FormField, useAppForm} from "@agenta/primitive-ui/components/form"
import {Input} from "@agenta/primitive-ui/components/input"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Switch} from "@agenta/primitive-ui/components/switch"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {Plus, TrashIcon} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"
import {z} from "zod"

import useURL from "@/oss/hooks/useURL"
import {createProject, deleteProject, patchProject} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"
import {useProjectData} from "@/oss/state/project"

const projectFormSchema = z.object({
    name: z.string().trim().min(1, "Please enter a project name"),
    make_default: z.boolean().optional(),
})

type ProjectFormValues = z.input<typeof projectFormSchema>

const ProjectsSettings = () => {
    const {projects, isLoading} = useProjectData()
    const {workspaceId} = useURL()
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [activeProject, setActiveProject] = useState<ProjectsResponse | null>(null)
    const [pendingDelete, setPendingDelete] = useState<ProjectsResponse | null>(null)

    const createForm = useAppForm({
        schema: projectFormSchema,
        defaultValues: {name: "", make_default: false},
    })
    const renameForm = useAppForm({
        schema: projectFormSchema.pick({name: true}),
        defaultValues: {name: ""},
    })

    const scopedProjects = useMemo(() => {
        if (!projects) return []
        if (!workspaceId) return projects
        return projects.filter((project) => project.workspace_id === workspaceId)
    }, [projects, workspaceId])
    const canDeleteProjects = scopedProjects.length > 1

    const invalidateProjects = useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["projects"]})
    }, [queryClient])

    const createMutation = useMutation({
        mutationFn: (payload: ProjectFormValues) => createProject(payload),
        onSuccess: () => {
            toast.success("Project created")
            void invalidateProjects()
            createForm.reset()
            setCreateModalOpen(false)
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to create project"
            toast.error(detail)
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({projectId, name}: {projectId: string; name: string}) =>
            patchProject(projectId, {name}),
        onSuccess: () => {
            toast.success("Project renamed")
            void invalidateProjects()
            renameForm.reset()
            setRenameModalOpen(false)
            setActiveProject(null)
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to rename project"
            toast.error(detail)
        },
    })

    const defaultMutation = useMutation({
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
        onSuccess: () => {
            toast.success("Default project updated")
            void invalidateProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to set default"
            toast.error(detail)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) => deleteProject(projectId),
        onSuccess: () => {
            toast.success("Project deleted")
            void invalidateProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to delete project"
            toast.error(detail)
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
        (values: Pick<ProjectFormValues, "name">) => {
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

    const confirmDelete = useCallback(() => {
        if (!canDeleteProjects || !pendingDelete) return
        deleteMutation.mutate(pendingDelete.project_id)
        setPendingDelete(null)
    }, [canDeleteProjects, deleteMutation, pendingDelete])

    const openRenameModal = useCallback(
        (project: ProjectsResponse) => {
            setActiveProject(project)
            renameForm.reset({name: project.project_name})
            setRenameModalOpen(true)
        },
        [renameForm],
    )

    const columns: ColumnDef<ProjectsResponse, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                accessorKey: "project_name",
                header: "Project",
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold">{record.project_name}</span>
                                {record.is_default_project && (
                                    <Badge variant="secondary">Default</Badge>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {record.project_id}
                            </span>
                        </div>
                    )
                },
            },
            {
                id: "workspace",
                accessorKey: "workspace_name",
                header: "Workspace",
                enableSorting: false,
                cell: ({row}) => row.original.workspace_name || "—",
            },
            {
                id: "role",
                accessorKey: "user_role",
                header: "Role",
                enableSorting: false,
                cell: ({row}) =>
                    row.original.user_role ? (
                        <Badge variant="outline">{row.original.user_role}</Badge>
                    ) : (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                id: "actions",
                header: "Actions",
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex items-center gap-1">
                            <Button
                                variant="link"
                                size="sm"
                                onClick={() => openRenameModal(record)}
                            >
                                Rename
                            </Button>
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="link"
                                            size="sm"
                                            disabled={record.is_default_project}
                                            onClick={() => handleMakeDefault(record)}
                                        >
                                            {defaultMutation.isPending &&
                                            defaultMutation.variables === record.project_id ? (
                                                <Spinner />
                                            ) : null}
                                            Set default
                                        </Button>
                                    }
                                />
                                {record.is_default_project && (
                                    <TooltipContent>Already default</TooltipContent>
                                )}
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="text-destructive"
                                            aria-label="Delete project"
                                            disabled={
                                                !canDeleteProjects || record.is_default_project
                                            }
                                            onClick={() => setPendingDelete(record)}
                                        >
                                            {deleteMutation.isPending &&
                                            deleteMutation.variables === record.project_id ? (
                                                <Spinner />
                                            ) : (
                                                <TrashIcon />
                                            )}
                                        </Button>
                                    }
                                />
                                {(!canDeleteProjects || record.is_default_project) && (
                                    <TooltipContent>
                                        {canDeleteProjects
                                            ? "Default project cannot be deleted"
                                            : "At least one project must remain in this workspace"}
                                    </TooltipContent>
                                )}
                            </Tooltip>
                        </div>
                    )
                },
            },
        ],
        [
            canDeleteProjects,
            defaultMutation.isPending,
            defaultMutation.variables,
            deleteMutation.isPending,
            deleteMutation.variables,
            handleMakeDefault,
            openRenameModal,
        ],
    )

    const tableLoading =
        isLoading ||
        createMutation.isPending ||
        renameMutation.isPending ||
        defaultMutation.isPending ||
        deleteMutation.isPending

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <Button onClick={() => setCreateModalOpen(true)}>
                    <Plus size={14} />
                    New project
                </Button>
            </div>

            <div className="shadow-sm rounded-lg border border-border">
                <DataTable<ProjectsResponse>
                    columns={columns}
                    data={scopedProjects}
                    getRowId={(record) => record.project_id}
                    loading={tableLoading}
                    enableSorting={false}
                    emptyText={
                        <Empty>
                            <EmptyHeader>
                                <EmptyDescription>
                                    No projects found for this workspace yet.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    }
                />
            </div>

            <Dialog
                open={isCreateModalOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setCreateModalOpen(false)
                        createForm.reset()
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create project</DialogTitle>
                    </DialogHeader>
                    <Form id="create-project-form" form={createForm} onSubmit={handleCreate}>
                        <FormField name="name" label="Project name">
                            {(field) => (
                                <Input
                                    {...field}
                                    placeholder="e.g. Production evaluation"
                                    autoFocus
                                />
                            )}
                        </FormField>
                        <FormField
                            name="make_default"
                            label="Make default project"
                            description="The default project is used whenever a workspace is selected from the navigation."
                        >
                            {({value, onChange, ...field}) => (
                                <Switch
                                    checked={Boolean(value)}
                                    onCheckedChange={(checked) => onChange(checked)}
                                    name={field.name}
                                />
                            )}
                        </FormField>
                    </Form>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setCreateModalOpen(false)
                                createForm.reset()
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="create-project-form"
                            disabled={createMutation.isPending}
                        >
                            {createMutation.isPending ? <Spinner /> : null}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={isRenameModalOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setRenameModalOpen(false)
                        setActiveProject(null)
                        renameForm.reset()
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename project</DialogTitle>
                    </DialogHeader>
                    <Form id="rename-project-form" form={renameForm} onSubmit={handleRename}>
                        <FormField name="name" label="Project name">
                            {(field) => <Input {...field} placeholder="Project name" />}
                        </FormField>
                    </Form>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setRenameModalOpen(false)
                                setActiveProject(null)
                                renameForm.reset()
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="rename-project-form"
                            disabled={renameMutation.isPending}
                        >
                            {renameMutation.isPending ? <Spinner /> : null}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete project</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete{" "}
                            <strong>{pendingDelete?.project_name}</strong>? This action cannot be
                            undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white"
                            onClick={confirmDelete}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}

export default ProjectsSettings
