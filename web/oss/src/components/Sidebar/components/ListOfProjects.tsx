import {memo, useCallback, useMemo, useState} from "react"

import {CaretDown, CopyIcon, PencilSimple, Star, Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {
    Button,
    ButtonProps,
    Dropdown,
    DropdownProps,
    Form,
    Input,
    MenuProps,
    Modal,
    Tag,
    message,
} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {createProject, deleteProject, patchProject} from "@/oss/services/project"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {useOrgData} from "@/oss/state/org"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {cacheLastUsedProjectId, useProjectData} from "@/oss/state/project"
import {settingsTabAtom} from "@/oss/state/settings"

interface ListOfProjectsProps {
    collapsed: boolean
    buttonProps?: ButtonProps
    interactive?: boolean
    selectedOrganizationId?: string | null
    dropdownProps?: Omit<DropdownProps, "menu" | "children">
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
    dropdownProps,
}: ListOfProjectsProps) => {
    const router = useRouter()
    const {orgs} = useOrgData()
    const {project, projects, refetch} = useProjectData()
    const settingsTab = useAtomValue(settingsTabAtom)

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
        mutationFn: ({name}: ProjectFormValues) => createProject({name: name.trim()}),
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
            patchProject(projectId, {name: name.trim()}),
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
        mutationFn: (projectId: string) => patchProject(projectId, {make_default: true}),
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
        mutationFn: (projectId: string) => deleteProject(projectId),
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

    const sharedButtonProps = useMemo(() => {
        if (!buttonProps) {
            return {
                className: undefined,
                type: undefined,
                disabled: undefined,
                rest: {} as ButtonProps,
            }
        }

        const {className, type, disabled, ...rest} = buttonProps
        return {className, type, disabled, rest: rest as ButtonProps}
    }, [buttonProps])

    const renderSelectionButton = (
        label: string,
        placeholder: string,
        isOpen: boolean,
        showCaret: boolean,
        disabled?: boolean,
    ) => (
        <Button
            type={sharedButtonProps.type ?? "text"}
            className={clsx(
                "flex items-center justify-between gap-2 w-full px-1.5 py-3",
                {"!w-auto": collapsed},
                sharedButtonProps.className,
            )}
            disabled={disabled || sharedButtonProps.disabled}
            {...sharedButtonProps.rest}
        >
            <span
                className={clsx("truncate", collapsed ? "max-w-[52px]" : "max-w-[180px]")}
                title={label || placeholder}
            >
                {label || placeholder}
            </span>
            {!collapsed && showCaret && (
                <CaretDown
                    size={14}
                    className={clsx("transition-transform", isOpen ? "rotate-180" : "")}
                />
            )}
        </Button>
    )

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

            // Preserve current page route if on settings page
            const isOnSettingsPage = router.pathname.includes('/settings')
            const currentTab =
                (settingsTab && settingsTab !== "workspace" ? settingsTab : undefined) ??
                (router.query.tab as string | undefined)

            let href: string
            if (isOnSettingsPage) {
                // Keep settings page and tab when switching project
                const tabParam = currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ""
                href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/settings${tabParam}`
            } else {
                // Default behavior for non-settings pages
                href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
            }

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

    const {projectMenuItems, projectKeyMap} = useMemo(() => {
        const keyMap: Record<string, ProjectMeta> = {}
        const items: MenuProps["items"] = projectsForSelectedOrganization.map((proj) => {
            const key = `project:${proj.workspace_id}:${proj.project_id}`
            keyMap[key] = {
                key,
                projectId: proj.project_id,
                workspaceId: proj.workspace_id || "",
                organizationId: proj.organization_id ?? selectedOrganizationId,
                project: proj,
            }

            const isActiveProject =
                proj.project_id === project?.project_id &&
                proj.workspace_id === project?.workspace_id

            const children: MenuProps["items"] | undefined = isActiveProject
                ? [
                      {
                          key: `project-action:set-default:${proj.workspace_id}:${proj.project_id}`,
                          label: (
                              <div className="flex items-center gap-2">
                                  <Star size={16} />
                                  Set as default
                              </div>
                          ),
                          disabled: proj.is_default_project,
                      },
                      {
                          key: `project-action:copy:${proj.workspace_id}:${proj.project_id}`,
                          label: (
                              <div className="flex items-center gap-2">
                                  <CopyIcon size={16} />
                                  Copy ID
                              </div>
                          ),
                      },
                      {
                          key: `project-action:rename:${proj.workspace_id}:${proj.project_id}`,
                          label: (
                              <div className="flex items-center gap-2">
                                  <PencilSimple size={16} />
                                  Rename
                              </div>
                          ),
                      },
                      {
                          key: `project-action:delete:${proj.workspace_id}:${proj.project_id}`,
                          label: (
                              <div className="flex items-center gap-2">
                                  <Trash size={16} />
                                  Delete
                              </div>
                          ),
                          disabled: !canDeleteProjects || proj.is_default_project,
                          danger: true,
                      },
                  ]
                : undefined

            return {
                key,
                disabled: !interactive,
                label: (
                    <div className="flex items-center gap-2 w-full max-w-[300px]">
                        <span className="truncate">{proj.project_name}</span>
                        {proj.is_default_project && (
                            <Tag className="bg-[#0517290F] m-0">default</Tag>
                        )}
                    </div>
                ),
                children,
            }
        })

        if (items.length) {
            items.push({type: "divider", key: "projects-divider"})
        }

        items.push({
            key: "project:new",
            label: (
                <div className="flex items-center gap-2 text-primary-500">
                    <span className="font-medium">+ New project</span>
                </div>
            ),
        })

        return {projectMenuItems: items, projectKeyMap: keyMap}
    }, [
        canDeleteProjects,
        interactive,
        project,
        projectsForSelectedOrganization,
        selectedOrganizationId,
    ])

    const shouldRenderProjectsDropdown = projectsForSelectedOrganization.length > 0

    const selectedProjectKey =
        project?.workspace_id && project?.project_id
            ? [`project:${project.workspace_id}:${project.project_id}`]
            : undefined

    const handleProjectMenuClick: MenuProps["onClick"] = ({key}) => {
        const keyString = key as string

        if (keyString === "project:new") {
            setProjectDropdownOpen(false)
            createForm.resetFields()
            setCreateModalOpen(true)
            return
        }

        if (keyString.startsWith("project-action:")) {
            const [, action, workspaceId, projectId] = keyString.split(":")
            const parentKey = `project:${workspaceId}:${projectId}`
            const meta = projectKeyMap[parentKey]
            if (!meta) return
            setProjectDropdownOpen(false)

            if (action === "set-default") {
                handleMakeDefault(meta.project)
            } else if (action === "copy") {
                void copyProjectId(meta.project.project_id)
            } else if (action === "rename") {
                openRenameModal(meta.project)
            } else if (action === "delete") {
                if (!canDeleteProjects) return
                confirmDeleteProject(meta.project)
            }
            return
        }

        const meta = projectKeyMap[keyString]
        if (!meta) return
        setProjectDropdownOpen(false)
        navigateToProject(meta.workspaceId, meta.projectId, meta.organizationId ?? null)
    }

    return (
        <>
            {shouldRenderProjectsDropdown ? (
                interactive ? (
                    <Dropdown
                        {...(dropdownProps ?? {})}
                        trigger={["click"]}
                        placement={collapsed ? "bottomLeft" : "bottomRight"}
                        destroyOnHidden
                        styles={{
                            root: {
                                zIndex: 2000,
                            },
                        }}
                        onOpenChange={setProjectDropdownOpen}
                        className={clsx({"flex items-center justify-center": collapsed})}
                        menu={{
                            items: projectMenuItems,
                            selectedKeys: selectedProjectKey,
                            onClick: handleProjectMenuClick,
                            className: "max-h-80 overflow-y-auto",
                        }}
                    >
                        {renderSelectionButton(
                            projectButtonLabel,
                            "Projects",
                            projectDropdownOpen,
                            true,
                        )}
                    </Dropdown>
                ) : (
                    <div className={clsx({"flex items-center justify-center": collapsed})}>
                        {renderSelectionButton(projectButtonLabel, "Projects", false, false, true)}
                    </div>
                )
            ) : (
                <Button
                    type={sharedButtonProps.type ?? "text"}
                    className={clsx(
                        "flex items-center justify-between gap-2 w-full px-1.5 py-3 text-left",
                        {"!w-auto": collapsed},
                        sharedButtonProps.className,
                    )}
                    disabled
                    {...sharedButtonProps.rest}
                >
                    {!collapsed && <span className="truncate">No projects</span>}
                </Button>
            )}

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
            </Modal>
        </>
    )
}

export default memo(ListOfProjects)
