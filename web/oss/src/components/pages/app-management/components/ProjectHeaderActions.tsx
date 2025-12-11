import {useCallback, useMemo, useState} from "react"

import {DotsThreeVertical, PencilSimple, Star, Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {Button, Dropdown, Form, Input, MenuProps, Modal, message} from "antd"
import {useRouter} from "next/router"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {deleteProject, patchProject} from "@/oss/services/project"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {cacheLastUsedProjectId, useProjectData} from "@/oss/state/project"

interface ProjectFormValues {
    name: string
}

const ProjectHeaderActions = () => {
    const router = useRouter()
    const {project, projects, refetch} = useProjectData()
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [renameForm] = Form.useForm<ProjectFormValues>()

    const canDeleteProject = useMemo(() => projects.filter(Boolean).length > 1, [projects])

    const navigateToProject = useCallback(
        (target: ProjectsResponse) => {
            const workspaceKey = target.workspace_id || target.organization_id || ""
            if (!workspaceKey || !target.project_id) return
            cacheLastUsedProjectId(workspaceKey, target.project_id)
            if (target.organization_id) cacheWorkspaceOrgPair(workspaceKey, target.organization_id)
            const href = `/w/${encodeURIComponent(workspaceKey)}/p/${encodeURIComponent(
                target.project_id,
            )}/apps`
            void router.push(href)
        },
        [router],
    )

    const findFallbackProject = useCallback(
        (excludedProjectId: string) => {
            if (!project?.workspace_id) return null
            const workspaceId = project.workspace_id
            const candidates = projects.filter(
                (proj): proj is ProjectsResponse =>
                    !!proj &&
                    !!proj.project_id &&
                    proj.project_id !== excludedProjectId &&
                    proj.workspace_id === workspaceId,
            )

            if (!candidates.length) return null

            const defaultProject = candidates.find((proj) => proj.is_default_project)
            if (defaultProject) return defaultProject

            const nonDemoProject = candidates.find((proj) => !proj.is_demo)
            if (nonDemoProject) return nonDemoProject

            return candidates[0]
        },
        [project?.workspace_id, projects],
    )

    const renameMutation = useMutation({
        mutationFn: ({name}: ProjectFormValues) => {
            if (!project?.project_id) return Promise.resolve()
            return patchProject(project.project_id, {name: name.trim()})
        },
        onSuccess: () => {
            message.success("Project renamed")
            void refetch()
            setIsRenameModalOpen(false)
            renameForm.resetFields()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to rename project"
            message.error(detail)
        },
    })

    const defaultMutation = useMutation({
        mutationFn: () => {
            if (!project?.project_id) return Promise.resolve()
            return patchProject(project.project_id, {make_default: true})
        },
        onSuccess: () => {
            message.success("Default project updated")
            void refetch()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to set default"
            message.error(detail)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: () => {
            if (!project?.project_id) return Promise.resolve()
            return deleteProject(project.project_id)
        },
        onSuccess: async () => {
            message.success("Project deleted")
            const fallback = project?.project_id ? findFallbackProject(project.project_id) : null
            if (fallback) {
                navigateToProject(fallback)
            }
            await refetch()
            if (!fallback && project?.workspace_id) {
                await router.push(`/w/${encodeURIComponent(project.workspace_id)}`)
            }
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to delete project"
            message.error(detail)
        },
    })

    const confirmDelete = useCallback(() => {
        if (!project?.project_name) return
        AlertPopup({
            title: "Delete project",
            message: (
                <div className="space-y-2">
                    <p>
                        Are you sure you want to delete <strong>{project.project_name}</strong>?
                    </p>
                    <p className="text-xs text-neutral-500">This action cannot be undone.</p>
                </div>
            ),
            okText: "Delete",
            okType: "danger",
            onOk: async () => {
                await deleteMutation.mutateAsync()
            },
        })
    }, [deleteMutation, project?.project_name])

    const menuItems = useMemo<MenuProps["items"]>(() => {
        if (!project) return []
        return [
            {
                key: "set-default",
                label: (
                    <div className="flex items-center gap-2">
                        <Star size={16} />
                        Set as default
                    </div>
                ),
                disabled: project.is_default_project,
            },
            {
                key: "rename",
                label: (
                    <div className="flex items-center gap-2">
                        <PencilSimple size={16} />
                        Rename
                    </div>
                ),
            },
            {
                key: "delete",
                danger: true,
                label: (
                    <div className="flex items-center gap-2">
                        <Trash size={16} />
                        Delete
                    </div>
                ),
                disabled: !canDeleteProject || project.is_default_project,
            },
        ]
    }, [canDeleteProject, project])

    const handleMenuClick: MenuProps["onClick"] = useCallback(
        ({key}) => {
            if (!project) return
            if (key === "set-default" && !project.is_default_project) {
                defaultMutation.mutate()
                return
            }
            if (key === "rename") {
                renameForm.setFieldsValue({name: project.project_name})
                setIsRenameModalOpen(true)
                return
            }
            if (key === "delete" && canDeleteProject) {
                confirmDelete()
            }
        },
        [canDeleteProject, confirmDelete, defaultMutation, project, renameForm],
    )

    if (!project) return null

    return (
        <>
            <Dropdown
                trigger={["click"]}
                placement="bottomLeft"
                destroyOnHidden
                menu={{items: menuItems, onClick: handleMenuClick}}
            >
                <Button type="text" icon={<DotsThreeVertical size={16} weight="bold" />} />
            </Dropdown>

            <Modal
                title="Rename project"
                open={isRenameModalOpen}
                okText="Save"
                onCancel={() => {
                    setIsRenameModalOpen(false)
                    renameForm.resetFields()
                }}
                onOk={() => renameForm.submit()}
                confirmLoading={renameMutation.isPending}
                destroyOnHidden
                centered
            >
                <Form
                    form={renameForm}
                    layout="vertical"
                    onFinish={(values) => renameMutation.mutate(values)}
                    initialValues={{name: project?.project_name}}
                >
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="Project name" autoFocus />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}

export default ProjectHeaderActions
