import {useCallback, useMemo, useState} from "react"

import {Tag} from "@agenta/ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {CheckCircle, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useMutation, useQueryClient} from "@tanstack/react-query"
import {App, Button, Form, Input, Switch} from "antd"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import useURL from "@/oss/hooks/useURL"
import {createProject, deleteProject, patchProject} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"
import {useProjectData} from "@/oss/state/project"

interface ProjectFormValues {
    name: string
    make_default?: boolean
}

interface ProjectRow extends ProjectsResponse {
    key: string
    [extra: string]: unknown
}

const ProjectsSettings = () => {
    const {message} = App.useApp()
    const {projects, isLoading} = useProjectData()
    const {workspaceId} = useURL()
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<ProjectsResponse | null>(null)
    const [activeProject, setActiveProject] = useState<ProjectsResponse | null>(null)
    const [searchTerm, setSearchTerm] = useState("")

    const [createForm] = Form.useForm<ProjectFormValues>()
    const [renameForm] = Form.useForm<ProjectFormValues>()

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
            createForm.resetFields()
            setCreateModalOpen(false)
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to create project"
            message.error(detail)
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({projectId, name}: {projectId: string; name: string}) =>
            patchProject(projectId, {name}),
        onSuccess: () => {
            message.success("Project renamed")
            void invalidateProjects()
            renameForm.resetFields()
            setRenameModalOpen(false)
            setActiveProject(null)
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to rename project"
            message.error(detail)
        },
    })

    const defaultMutation = useMutation({
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
        onSuccess: () => {
            message.success("Default project updated")
            void invalidateProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to set default"
            message.error(detail)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) => deleteProject(projectId),
        onSuccess: () => {
            message.success("Project deleted")
            void invalidateProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to delete project"
            message.error(detail)
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

    const openRenameModal = useCallback(
        (project: ProjectsResponse) => {
            setActiveProject(project)
            renameForm.setFieldsValue({name: project.project_name})
            setRenameModalOpen(true)
        },
        [renameForm],
    )

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
                    <Input.Search
                        placeholder="Search projects"
                        className="w-[260px]"
                        allowClear
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        disabled={isLoading}
                    />
                }
                primaryActions={
                    <Button
                        type="primary"
                        icon={<Plus size={14} />}
                        onClick={() => setCreateModalOpen(true)}
                        disabled={isLoading}
                    >
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
                                <Button
                                    icon={<Plus size={14} />}
                                    onClick={() => setCreateModalOpen(true)}
                                >
                                    New project
                                </Button>
                            </EmptyState>
                        ),
                    },
                }}
            />

            <EnhancedModal
                title="Create project"
                open={isCreateModalOpen}
                okText="Create"
                onCancel={() => {
                    setCreateModalOpen(false)
                    createForm.resetFields()
                }}
                onOk={() => createForm.submit()}
                confirmLoading={createMutation.isPending}
            >
                <Form form={createForm} layout="vertical" onFinish={handleCreate}>
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="e.g. Production evaluation" autoFocus />
                    </Form.Item>
                    <Form.Item
                        label="Make default project"
                        name="make_default"
                        valuePropName="checked"
                        extra="The default project is used whenever a workspace is selected from the navigation."
                    >
                        <Switch />
                    </Form.Item>
                </Form>
            </EnhancedModal>

            <EnhancedModal
                title="Rename project"
                open={isRenameModalOpen}
                okText="Save"
                onCancel={() => {
                    setRenameModalOpen(false)
                    setActiveProject(null)
                    renameForm.resetFields()
                }}
                onOk={() => renameForm.submit()}
                confirmLoading={renameMutation.isPending}
            >
                <Form form={renameForm} layout="vertical" onFinish={handleRename}>
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="Project name" />
                    </Form.Item>
                </Form>
            </EnhancedModal>

            <EnhancedModal
                title="Delete project"
                open={Boolean(projectToDelete)}
                okText="Delete project"
                okType="danger"
                okButtonProps={{icon: <Trash size={14} />, type: "primary"}}
                onCancel={() => setProjectToDelete(null)}
                onOk={() => {
                    if (!projectToDelete) return
                    deleteMutation.mutate(projectToDelete.project_id)
                    setProjectToDelete(null)
                }}
                confirmLoading={deleteMutation.isPending}
                width={450}
            >
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-3">
                    <span className="font-medium text-[var(--ant-color-error)]">
                        This action cannot be undone.
                    </span>
                    <span className="text-[var(--ant-color-text)]">
                        Permanently deletes {projectToDelete?.project_name}, including all of its
                        agents, datasets, and deployments.
                    </span>
                </div>
            </EnhancedModal>
        </div>
    )
}

export default ProjectsSettings
