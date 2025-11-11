import {useCallback, useMemo, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {useMutation, useQueryClient} from "@tanstack/react-query"
import {
    Button,
    Empty,
    Form,
    Input,
    Modal,
    Space,
    Switch,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
} from "antd"
import type {ColumnsType} from "antd/es/table"

import useURL from "@/oss/hooks/useURL"
import {ProjectsResponse} from "@/oss/services/project/types"
import {createProject, patchProject} from "@/oss/services/project"
import {useProjectData} from "@/oss/state/project"

const {Paragraph, Text} = Typography

type ProjectFormValues = {
    name: string
    make_default?: boolean
}

const ProjectsSettings = () => {
    const {projects, isLoading} = useProjectData()
    const {workspaceId} = useURL()
    const queryClient = useQueryClient()

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [activeProject, setActiveProject] = useState<ProjectsResponse | null>(null)

    const [createForm] = Form.useForm<ProjectFormValues>()
    const [renameForm] = Form.useForm<ProjectFormValues>()

    const scopedProjects = useMemo(() => {
        if (!projects) return []
        if (!workspaceId) return projects
        return projects.filter((project) => project.workspace_id === workspaceId)
    }, [projects, workspaceId])

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
            const detail = error?.response?.data?.detail || error?.message || "Unable to create project"
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
            const detail = error?.response?.data?.detail || error?.message || "Unable to rename project"
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
            const detail = error?.response?.data?.detail || error?.message || "Unable to set default"
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

    const openRenameModal = useCallback(
        (project: ProjectsResponse) => {
            setActiveProject(project)
            renameForm.setFieldsValue({name: project.project_name})
            setRenameModalOpen(true)
        },
        [renameForm],
    )

    const columns: ColumnsType<ProjectsResponse> = useMemo(
        () => [
            {
                title: "Project",
                dataIndex: "project_name",
                key: "name",
                render: (_value, record) => (
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <Text strong>{record.project_name}</Text>
                            {record.is_default_project && <Tag color="blue">Default</Tag>}
                        </div>
                        <Text type="secondary" className="text-xs">
                            {record.project_id}
                        </Text>
                    </div>
                ),
            },
            {
                title: "Workspace",
                dataIndex: "workspace_name",
                key: "workspace",
                render: (value: string | undefined) => value || "—",
            },
            {
                title: "Role",
                dataIndex: "user_role",
                key: "role",
                render: (value: string | undefined | null) =>
                    value ? <Tag>{value}</Tag> : <Text type="secondary">—</Text>,
            },
            {
                title: "Actions",
                key: "actions",
                render: (_value, record) => (
                    <Space size="small">
                        <Button type="link" size="small" onClick={() => openRenameModal(record)}>
                            Rename
                        </Button>
                        <Tooltip title={record.is_default_project ? "Already default" : undefined}>
                            <Button
                                type="link"
                                size="small"
                                disabled={record.is_default_project}
                                onClick={() => handleMakeDefault(record)}
                                loading={defaultMutation.isPending && defaultMutation.variables === record.project_id}
                            >
                                Set default
                            </Button>
                        </Tooltip>
                    </Space>
                ),
            },
        ],
        [defaultMutation.isPending, defaultMutation.variables, handleMakeDefault, openRenameModal],
    )

    const tableLoading =
        isLoading ||
        createMutation.isPending ||
        renameMutation.isPending ||
        defaultMutation.isPending

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setCreateModalOpen(true)}
                >
                    New project
                </Button>
            </div>

            <Table<ProjectsResponse>
                dataSource={scopedProjects}
                columns={columns}
                rowKey={(record) => record.project_id}
                loading={tableLoading}
                locale={{
                    emptyText: (
                        <Empty
                            description="No projects found for this workspace yet."
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    ),
                }}
                pagination={false}
                className="shadow-sm rounded-lg border border-neutral-100"
            />

            <Modal
                title="Create project"
                open={isCreateModalOpen}
                okText="Create"
                onCancel={() => {
                    setCreateModalOpen(false)
                    createForm.resetFields()
                }}
                onOk={() => createForm.submit()}
                confirmLoading={createMutation.isPending}
                destroyOnClose
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
            </Modal>

            <Modal
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
                destroyOnClose
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
            </Modal>
        </section>
    )
}

export default ProjectsSettings
