import {Fragment, memo, useCallback, useMemo, useState} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Input} from "@agenta/primitive-ui/components/input"
import {InitialsAvatar} from "@agenta/ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {CopyIcon, PencilSimple, Star, Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {ButtonProps, Form, message} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {buildProjectSwitchHref} from "@/oss/lib/navigation/projectSwitchHref"
import {createProject, deleteProject, patchProject} from "@/oss/services/project"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {useOrgData} from "@/oss/state/org"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {cacheLastUsedProjectId, useProjectData} from "@/oss/state/project"
import {settingsTabAtom} from "@/oss/state/settings"

import SidebarSelectionButton from "./SidebarSelectionButton"

interface ListOfProjectsProps {
    collapsed: boolean
    buttonProps?: ButtonProps
    interactive?: boolean
    selectedOrganizationId?: string | null
}

interface ProjectMeta {
    key: string
    projectId: string
    workspaceId: string
    organizationId?: string | null
    project: ProjectsResponse
}

interface ProjectFormValues {
    name: string
}

const ListOfProjects = ({
    collapsed,
    buttonProps,
    interactive = true,
    selectedOrganizationId,
}: ListOfProjectsProps) => {
    const router = useRouter()
    const {orgs} = useOrgData()
    const {project, projects, refetch} = useProjectData()
    const settingsTab = useAtomValue(settingsTabAtom)
    const {workspaceId: currentWorkspaceId} = useAtomValue(appIdentifiersAtom)

    const totalProjects = useMemo(() => projects.filter(Boolean).length, [projects])
    const canDeleteProjects = totalProjects > 1

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
    const [activeProject, setActiveProject] = useState<ProjectsResponse | null>(null)

    const [createForm] = Form.useForm<ProjectFormValues>()
    const [renameForm] = Form.useForm<ProjectFormValues>()

    const projectsByOrganization = useMemo(() => {
        const map = new Map<string, ProjectsResponse[]>()
        orgs.forEach((org) => {
            map.set(org.id, [])
        })

        projects.forEach((proj) => {
            if (!proj) return
            const organizationId =
                proj.organization_id ||
                orgs.find((org) => org.default_workspace?.id === proj.workspace_id)?.id
            if (!organizationId) return
            if (!map.has(organizationId)) {
                map.set(organizationId, [])
            }
            map.get(organizationId)?.push(proj)
        })

        return map
    }, [orgs, projects])

    const projectsForSelectedOrganization = useMemo(() => {
        if (!selectedOrganizationId) return []
        return projectsByOrganization.get(selectedOrganizationId) ?? []
    }, [projectsByOrganization, selectedOrganizationId])

    const refreshProjects = useCallback(async () => {
        await refetch()
    }, [refetch])

    const resolveWorkspaceKey = useCallback(
        (target?: {workspace_id?: string | null; organization_id?: string | null}) =>
            target?.workspace_id || target?.organization_id || selectedOrganizationId || "",
        [selectedOrganizationId],
    )

    const createMutation = useMutation({
        mutationFn: ({name}: ProjectFormValues) =>
            createProject({name: name.trim()}, currentWorkspaceId ?? undefined),
        onSuccess: (createdProject) => {
            message.success("Project created")
            createForm.resetFields()
            setCreateModalOpen(false)

            const workspaceKey = resolveWorkspaceKey(createdProject)
            if (workspaceKey && createdProject?.project_id) {
                cacheLastUsedProjectId(workspaceKey, createdProject.project_id)
                navigateToProject(
                    workspaceKey,
                    createdProject.project_id,
                    createdProject.organization_id ?? selectedOrganizationId,
                )
            }

            void refreshProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to create project"
            message.error(detail)
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({projectId, name}: {projectId: string; name: string}) =>
            patchProject(projectId, {name: name.trim()}, currentWorkspaceId ?? undefined),
        onSuccess: () => {
            message.success("Project renamed")
            void refreshProjects()
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
        mutationFn: (projectId: string) =>
            patchProject(projectId, {make_default: true}, currentWorkspaceId ?? undefined),
        onSuccess: () => {
            message.success("Default project updated")
            void refreshProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to set default"
            message.error(detail)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) =>
            deleteProject(projectId, currentWorkspaceId ?? undefined),
        onSuccess: () => {
            message.success("Project deleted")
            void refreshProjects()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to delete project"
            message.error(detail)
        },
    })

    const projectButtonLabel =
        project?.project_name ||
        (projectsForSelectedOrganization.length ? "Select project" : "No projects")

    const copyProjectId = useCallback(async (projectId: string) => {
        if (typeof navigator === "undefined" || !navigator?.clipboard) {
            message.error("Clipboard not supported")
            return
        }

        try {
            await navigator.clipboard.writeText(projectId)
            message.success("Project ID copied")
        } catch (error) {
            message.error("Failed to copy project ID")
        }
    }, [])

    const openRenameModal = useCallback(
        (target: ProjectsResponse) => {
            setActiveProject(target)
            renameForm.setFieldsValue({name: target.project_name})
            setRenameModalOpen(true)
        },
        [renameForm],
    )

    const handleMakeDefault = useCallback(
        (target: ProjectsResponse) => {
            if (!target.project_id || target.is_default_project) return
            defaultMutation.mutate(target.project_id)
        },
        [defaultMutation],
    )

    const navigateToProject = useCallback(
        (workspaceId: string, projectId: string, organizationId?: string | null) => {
            if (!workspaceId || !projectId) return
            cacheLastUsedProjectId(workspaceId, projectId)
            if (organizationId) cacheWorkspaceOrgPair(workspaceId, organizationId)

            const href = buildProjectSwitchHref({
                workspaceId,
                projectId,
                currentAsPath: router.asPath,
                settingsTab,
                queryTab: router.query.tab,
            })

            void router.push(href)
        },
        [router, settingsTab],
    )

    const findFallbackProject = useCallback(
        (excludedProjectId: string) => {
            const candidates = projectsForSelectedOrganization.filter(
                (proj) => proj.project_id !== excludedProjectId,
            )

            if (!candidates.length) return null

            const defaultProject = candidates.find((proj) => proj.is_default_project)
            if (defaultProject) return defaultProject

            const nonDemoProject = candidates.find((proj) => !proj.is_demo)
            if (nonDemoProject) return nonDemoProject

            return candidates[0]
        },
        [projectsForSelectedOrganization],
    )

    const confirmDeleteProject = useCallback(
        (target: ProjectsResponse) => {
            AlertPopup({
                title: "Delete project",
                message: (
                    <div className="space-y-2">
                        <p>
                            Are you sure you want to delete <strong>{target.project_name}</strong>?
                        </p>
                        <p className="text-xs text-neutral-500">This action cannot be undone.</p>
                    </div>
                ),
                okText: "Delete",
                okType: "danger",
                onOk: async () => {
                    await deleteMutation.mutateAsync(target.project_id)
                    if (project?.project_id === target.project_id) {
                        const fallbackProject = findFallbackProject(target.project_id)
                        if (fallbackProject) {
                            const workspaceKey =
                                resolveWorkspaceKey(fallbackProject) || target.workspace_id || ""
                            navigateToProject(
                                workspaceKey,
                                fallbackProject.project_id,
                                fallbackProject.organization_id ?? selectedOrganizationId,
                            )
                        }
                    }
                    void refreshProjects()
                },
            })
        },
        [
            deleteMutation,
            findFallbackProject,
            navigateToProject,
            project?.project_id,
            refreshProjects,
            resolveWorkspaceKey,
            selectedOrganizationId,
        ],
    )

    const shouldRenderProjectsDropdown = projectsForSelectedOrganization.length > 0

    const selectedProjectKey =
        project?.workspace_id && project?.project_id
            ? `project:${project.workspace_id}:${project.project_id}`
            : ""

    const projectKeyMap = useMemo(() => {
        const keyMap: Record<string, ProjectMeta> = {}
        projectsForSelectedOrganization.forEach((proj) => {
            const key = `project:${proj.workspace_id}:${proj.project_id}`
            keyMap[key] = {
                key,
                projectId: proj.project_id,
                workspaceId: proj.workspace_id || "",
                organizationId: proj.organization_id ?? selectedOrganizationId,
                project: proj,
            }
        })
        return keyMap
    }, [projectsForSelectedOrganization, selectedOrganizationId])

    const handleNewProject = useCallback(() => {
        setProjectDropdownOpen(false)
        createForm.resetFields()
        setCreateModalOpen(true)
    }, [createForm])

    const handleProjectValueChange = useCallback(
        (key: string) => {
            setProjectDropdownOpen(false)
            const meta = projectKeyMap[key]
            if (!meta) return
            navigateToProject(meta.workspaceId, meta.projectId, meta.organizationId ?? null)
        },
        [projectKeyMap, navigateToProject],
    )

    return (
        <>
            {shouldRenderProjectsDropdown ? (
                interactive ? (
                    <DropdownMenu open={projectDropdownOpen} onOpenChange={setProjectDropdownOpen}>
                        <DropdownMenuTrigger
                            className={clsx({"flex items-center justify-center": collapsed})}
                        >
                            <div data-project-selector>
                                <SidebarSelectionButton
                                    collapsed={collapsed}
                                    label={projectButtonLabel}
                                    placeholder="Projects"
                                    isOpen={projectDropdownOpen}
                                    showCaret
                                    buttonProps={buttonProps}
                                />
                            </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align={collapsed ? "start" : "end"}
                            className="max-h-80 overflow-y-auto"
                            style={{zIndex: 2000}}
                        >
                            <DropdownMenuRadioGroup
                                value={selectedProjectKey}
                                onValueChange={handleProjectValueChange}
                            >
                                {projectsForSelectedOrganization.map((proj) => {
                                    const key = `project:${proj.workspace_id}:${proj.project_id}`
                                    const isActiveProject =
                                        proj.project_id === project?.project_id &&
                                        proj.workspace_id === project?.workspace_id

                                    return (
                                        <Fragment key={key}>
                                            <DropdownMenuRadioItem
                                                value={key}
                                                disabled={!interactive}
                                                closeOnClick
                                            >
                                                <div className="flex items-center gap-2 w-full max-w-[300px]">
                                                    <InitialsAvatar
                                                        size="small"
                                                        name={proj.project_name}
                                                    />
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span className="truncate">
                                                            {proj.project_name}
                                                        </span>
                                                        {proj.is_default_project && (
                                                            <Badge
                                                                className="bg-[var(--ag-c-0517290F)] m-0"
                                                                variant="secondary"
                                                            >
                                                                default
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </DropdownMenuRadioItem>

                                            {isActiveProject && (
                                                <>
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setProjectDropdownOpen(false)
                                                            handleMakeDefault(proj)
                                                        }}
                                                        disabled={proj.is_default_project}
                                                    >
                                                        <Star size={16} />
                                                        Set as default
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setProjectDropdownOpen(false)
                                                            void copyProjectId(proj.project_id)
                                                        }}
                                                    >
                                                        <CopyIcon size={16} />
                                                        Copy ID
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setProjectDropdownOpen(false)
                                                            openRenameModal(proj)
                                                        }}
                                                    >
                                                        <PencilSimple size={16} />
                                                        Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        variant="destructive"
                                                        onClick={() => {
                                                            if (!canDeleteProjects) return
                                                            setProjectDropdownOpen(false)
                                                            confirmDeleteProject(proj)
                                                        }}
                                                        disabled={
                                                            !canDeleteProjects ||
                                                            proj.is_default_project
                                                        }
                                                    >
                                                        <Trash size={16} />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </>
                                            )}
                                        </Fragment>
                                    )
                                })}
                            </DropdownMenuRadioGroup>

                            {projectsForSelectedOrganization.length > 0 && (
                                <DropdownMenuSeparator />
                            )}

                            <DropdownMenuItem onClick={handleNewProject}>
                                <span className="font-medium text-primary-500">+ New project</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <div className={clsx({"flex items-center justify-center": collapsed})}>
                        <SidebarSelectionButton
                            collapsed={collapsed}
                            label={projectButtonLabel}
                            placeholder="Projects"
                            isOpen={false}
                            showCaret={false}
                            disabled
                            buttonProps={buttonProps}
                        />
                    </div>
                )
            ) : (
                <div className={clsx({"flex items-center justify-center": collapsed})}>
                    <SidebarSelectionButton
                        collapsed={collapsed}
                        label="No projects"
                        placeholder="Projects"
                        isOpen={false}
                        showCaret={false}
                        disabled
                        buttonProps={buttonProps}
                    />
                </div>
            )}

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
                destroyOnHidden
                centered
            >
                <Form
                    form={createForm}
                    layout="vertical"
                    onFinish={(values) => createMutation.mutate(values)}
                >
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="Project name" autoFocus />
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
                destroyOnHidden
                centered
            >
                <Form
                    form={renameForm}
                    layout="vertical"
                    onFinish={(values) => {
                        if (!activeProject) return
                        renameMutation.mutate({
                            projectId: activeProject.project_id,
                            name: values.name,
                        })
                    }}
                >
                    <Form.Item
                        label="Project name"
                        name="name"
                        rules={[{required: true, message: "Please enter a project name"}]}
                    >
                        <Input placeholder="Project name" autoFocus />
                    </Form.Item>
                </Form>
            </EnhancedModal>
        </>
    )
}

export default memo(ListOfProjects)
