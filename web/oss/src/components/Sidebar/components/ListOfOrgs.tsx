import {memo, useMemo, useState} from "react"

import {ArrowsLeftRight, CaretDown, PencilSimple, Plus, SignOut, Trash} from "@phosphor-icons/react"
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
    Select,
    message,
} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useSession} from "@/oss/hooks/useSession"
import {isEE} from "@/oss/lib/helpers/isEE"
import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import {useOrgData} from "@/oss/state/org"
import {resetOrgData} from "@/oss/state/org"
import {
    orgsAtom as organizationsAtom,
    selectedOrgIdAtom,
    isPersonalOrg,
    clearWorkspaceOrgCache,
} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {resetProjectData} from "@/oss/state/project"
import {clearLastUsedProjectId} from "@/oss/state/project/selectors/project"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import Avatar from "../../Avatar/Avatar"

import ListOfProjects from "./ListOfProjects"

interface ListOfOrgsProps extends Omit<DropdownProps, "menu" | "children"> {
    collapsed: boolean
    buttonProps?: ButtonProps
    /**
     * When false, renders a non-interactive display (no dropdown, no navigation)
     * Useful on pages like post-signup where changing organization should not trigger redirects
     */
    interactive?: boolean
    /**
     * Optional override for currently selected organization id when URL-derived selection is not available
     */
    overrideOrganizationId?: string
    /**
     * When false, organization items remain visible but are not actionable. Logout remains actionable.
     */
    organizationSelectionEnabled?: boolean
}

const ListOfOrgs = ({
    collapsed,
    buttonProps,
    interactive = true,
    overrideOrganizationId,
    organizationSelectionEnabled = true,
    ...dropdownProps
}: ListOfOrgsProps) => {
    const router = useRouter()
    const {user} = useProfileData()
    const {logout} = useSession()
    const {selectedOrg: selectedOrganization, orgs: organizations, changeSelectedOrg, refetch} =
        useOrgData()
    const {members: workspaceMembers} = useWorkspaceMembers()
    const selectedOrganizationId = useAtomValue(selectedOrgIdAtom)
    const effectiveSelectedId =
        overrideOrganizationId || selectedOrganization?.id || selectedOrganizationId
    const organizationList = useAtomValue(organizationsAtom)
    const selectedBasicOrganization = useMemo(
        () =>
            organizationList.find((organization) => organization.id === effectiveSelectedId) ||
            null,
        [organizationList, effectiveSelectedId],
    )
    const {project} = useProjectData()
    const organizationDisplayName =
        selectedBasicOrganization?.name ||
        selectedOrganization?.name ||
        organizations?.[0]?.name ||
        "Organization"

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [createForm] = Form.useForm<{name: string; description?: string}>()

    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [renameForm] = Form.useForm<{name: string}>()
    const [orgToRename, setOrgToRename] = useState<string | null>(null)

    const [isTransferModalOpen, setTransferModalOpen] = useState(false)
    const [orgToTransfer, setOrgToTransfer] = useState<string | null>(null)
    const [newOwnerId, setNewOwnerId] = useState<string | null>(null)
    const transferOwnerOptions = useMemo(() => {
        const options = workspaceMembers
            .filter((member) => {
                // Only include actual members (not pending/expired invitations)
                const isActualMember = member.user?.status === "member"
                const hasValidId = member.user?.id && member.user.id !== user?.id
                console.log("🔧 Checking member eligibility:", {
                    email: member.user?.email,
                    status: member.user?.status,
                    id: member.user?.id,
                    isActualMember,
                    hasValidId,
                })
                return isActualMember && hasValidId
            })
            .map((member) => {
                const userId = member.user.id
                const email = member.user?.email ?? ""
                const displayName = member.user?.username || getUsernameFromEmail(email)
                const label = email ? `${displayName} ${email}` : displayName
                console.log("✅ Creating transfer option:", {
                    userId,
                    userIdType: typeof userId,
                    email,
                    displayName,
                    label,
                })
                return {
                    value: userId,
                    label,
                    displayName,
                    email,
                }
            })
        console.log("📋 Transfer owner options created:", options)
        return options
    }, [workspaceMembers, user?.id])
    const transferOwnerOptionCount = transferOwnerOptions.length
    const transferOwnerOptionByValue = useMemo(() => {
        const map = new Map<string, (typeof transferOwnerOptions)[number]>()
        transferOwnerOptions.forEach((option) => {
            map.set(String(option.value), option)
        })
        return map
    }, [transferOwnerOptions])

    const organizationMenuItems = useMemo<MenuProps["items"]>(() => {
        const items: MenuProps["items"] = organizations.map((organization) => {
            const isPersonal = isPersonalOrg(organization)
            const isOwner = organization.owner_id === user?.id
            const isSelectedOrganization = organization.id === effectiveSelectedId

            const baseItem = {
                key: `organization:${organization.id}`,
                disabled: !interactive || !organizationSelectionEnabled,
                label: (
                    <div className="flex items-center gap-2 justify-between w-full">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Avatar size="small" name={organization.name} />
                            <span className="truncate">{organization.name}</span>
                            {isPersonal && (
                            <span className="px-1.5 py-0.5 text-[11px] leading-none font-mono text-white bg-gray-400 rounded shrink-0">
                                Personal
                            </span>
                        )}
                        </div>
                    </div>
                ),
            }

            // Show submenu actions only for the currently selected org
            if (!isPersonal && isOwner && isEE() && isSelectedOrganization) {
                return {
                    ...baseItem,
                    children: [
                        {
                            key: `transfer:${organization.id}`,
                            label: (
                                <div className="flex items-center gap-2">
                                    <ArrowsLeftRight size={16} />
                                    Transfer ownership
                                </div>
                            ),
                        },
                        {
                            key: `rename:${organization.id}`,
                            label: (
                                <div className="flex items-center gap-2">
                                    <PencilSimple size={16} />
                                    Rename
                                </div>
                            ),
                        },
                        {
                            key: `delete:${organization.id}`,
                            danger: true,
                            label: (
                                <div className="flex items-center gap-2">
                                    <Trash size={16} />
                                    Delete
                                </div>
                            ),
                        },
                    ],
                }
            }

            return baseItem
        })

        if (items.length) {
            items.push({type: "divider", key: "organizations-divider"})
        }

        // Only show "Create Organization" in EE
        if (isEE()) {
            items.push({
                key: "create-organization",
                label: (
                    <div className="flex items-center gap-2">
                        <Plus size={16} />
                        Create Organization
                    </div>
                ),
            })
        }

        items.push({type: "divider", key: "logout-divider"})

        items.push({
            key: "logout",
            danger: true,
            label: (
                <div className="flex items-center gap-2">
                    <SignOut size={16} />
                    Logout
                </div>
            ),
        })

        return items
    }, [
        effectiveSelectedId,
        interactive,
        organizationSelectionEnabled,
        organizations,
        user?.id,
    ])

    const [organizationDropdownOpen, setOrganizationDropdownOpen] = useState(false)

    const organizationButtonLabel = organizationDisplayName

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
            <div className="flex items-center gap-2">
                <Avatar size="small" name={label || placeholder} />
                {!collapsed && (
                    <span className="max-w-[150px] truncate" title={label || placeholder}>
                        {label || placeholder}
                    </span>
                )}
            </div>
            {!collapsed && showCaret && (
                <CaretDown
                    size={14}
                    className={clsx("transition-transform", isOpen ? "rotate-180" : "")}
                />
            )}
        </Button>
    )

    const isPostSignupPage = router.pathname === "/post-signup"
    const canShow = Boolean(
        (project?.project_id || effectiveSelectedId || selectedOrganization?.id) && user?.id,
    )

    const createMutation = useMutation({
        mutationFn: async (values: {name: string; description?: string}) => {
            const {createOrganization} = await import("@/oss/services/organization/api")
            return createOrganization(values)
        },
        onSuccess: async (createdOrg) => {
            message.success("Organization created")
            createForm.resetFields()
            setCreateModalOpen(false)

            // Refetch organizations
            await refetch()

            // Select the newly created organization
            if (createdOrg?.id) {
                await changeSelectedOrg(createdOrg.id)
            }
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail ||
                error?.message ||
                "Unable to create organization"
            message.error(detail)
        },
    })

    const renameMutation = useMutation({
        mutationFn: async ({organizationId, name}: {organizationId: string; name: string}) => {
            const {updateOrganization} = await import("@/oss/services/organization/api")
            return updateOrganization(organizationId, name)
        },
        onSuccess: async () => {
            message.success("Organization renamed")
            renameForm.resetFields()
            setRenameModalOpen(false)
            setOrgToRename(null)
            await refetch()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail ||
                error?.message ||
                "Unable to rename organization"
            message.error(detail)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async (organizationId: string) => {
            const {deleteOrganization} = await import("@/oss/services/organization/api")
            return deleteOrganization(organizationId)
        },
        onSuccess: async () => {
            message.success("Organization deleted")
            resetOrgData()
            resetProjectData()
            await refetch()
        },
        onError: (error: any) => {
            const detail =
                error?.response?.data?.detail ||
                error?.message ||
                "Unable to delete organization"
            message.error(detail)
        },
    })

    const transferMutation = useMutation({
        mutationFn: async ({
            organizationId,
            newOwnerId,
        }: {
            organizationId: string
            newOwnerId: string
        }) => {
            console.log("🔄 Transfer ownership mutation started:", {
                organizationId,
                newOwnerId,
                newOwnerIdType: typeof newOwnerId,
            })
            const {transferOrganizationOwnership} = await import(
                "@/oss/services/organization/api"
            )
            const result = await transferOrganizationOwnership(organizationId, newOwnerId)
            console.log("✅ Transfer ownership result:", result)
            return result
        },
        onSuccess: async () => {
            console.log("✅ Transfer ownership success")
            message.success("Ownership transferred")
            setTransferModalOpen(false)
            setOrgToTransfer(null)
            setNewOwnerId(null)

            // Refetch all data to reflect ownership change
            await refetch()

            // Reset cached data to force fresh fetch
            resetOrgData()
            resetProjectData()
        },
        onError: (error: any) => {
            console.error("❌ Transfer ownership error:", {
                error,
                response: error?.response,
                data: error?.response?.data,
                detail: error?.response?.data?.detail,
            })
            const detail =
                error?.response?.data?.detail ||
                error?.message ||
                "Unable to transfer ownership"
            message.error(detail)
        },
    })

    const handleOrganizationMenuClick: MenuProps["onClick"] = ({key}) => {
        const keyString = key as string

        if (keyString === "logout") {
            setOrganizationDropdownOpen(false)
            AlertPopup({
                title: "Logout",
                message: "Are you sure you want to logout?",
                onOk: logout,
            })
            return
        }

        if (keyString === "create-organization") {
            setOrganizationDropdownOpen(false)
            setCreateModalOpen(true)
            return
        }

        // Handle rename action
        if (keyString.startsWith("rename:")) {
            const organizationId = keyString.split(":")[1]
            const org = organizations.find((o) => o.id === organizationId)
            if (org) {
                setOrgToRename(organizationId)
                renameForm.setFieldsValue({name: org.name})
                setRenameModalOpen(true)
            }
            setOrganizationDropdownOpen(false)
            return
        }

        // Handle transfer action
        if (keyString.startsWith("transfer:")) {
            const organizationId = keyString.split(":")[1]
            setOrgToTransfer(organizationId)
            setTransferModalOpen(true)
            setOrganizationDropdownOpen(false)
            return
        }

        // Handle delete action
        if (keyString.startsWith("delete:")) {
            const organizationId = keyString.split(":")[1]
            const org = organizations.find((o) => o.id === organizationId)
            if (org) {
                AlertPopup({
                    title: "Delete organization",
                    message: (
                        <div className="space-y-2">
                            <p>
                                Are you sure you want to delete <strong>{org.name}</strong>?
                            </p>
                            <p className="text-xs text-neutral-500">
                                This action cannot be undone.
                            </p>
                        </div>
                    ),
                    okText: "Delete",
                    okType: "danger",
                    onOk: async () => {
                        await deleteMutation.mutateAsync(organizationId)
                        const deletedOrg = organizations.find((org) => org.id === organizationId)
                        const deletedWorkspaceId = deletedOrg?.default_workspace?.id || null
                        clearWorkspaceOrgCache(deletedWorkspaceId)
                        clearLastUsedProjectId(deletedWorkspaceId)
                        // If we deleted the current org, select another one
                        if (effectiveSelectedId === organizationId) {
                            const remainingOrgs = organizations.filter(
                                (o) => o.id !== organizationId,
                            )
                            if (remainingOrgs.length > 0) {
                                await changeSelectedOrg(remainingOrgs[0].id)
                            }
                        }
                        resetOrgData()
                        resetProjectData()
                        await refetch()
                    },
                })
            }
            setOrganizationDropdownOpen(false)
            return
        }

        if (!interactive || !organizationSelectionEnabled) {
            setOrganizationDropdownOpen(false)
            return
        }

        const [, organizationId] = keyString.split(":")
        if (organizationId) {
            setOrganizationDropdownOpen(false)
            void changeSelectedOrg(organizationId)
        }
    }

    const selectedOrganizationKey = effectiveSelectedId
        ? [`organization:${effectiveSelectedId}`]
        : undefined

    return (
        <div className={clsx("flex flex-col gap-2 px-2 py-3", {"items-center": collapsed})}>
            {canShow ? (
                <>
                    {interactive ? (
                        <Dropdown
                            {...dropdownProps}
                            trigger={["click"]}
                            placement="bottomRight"
                            destroyOnHidden
                            styles={{
                                root: {
                                    zIndex: 2000,
                                },
                            }}
                            onOpenChange={setOrganizationDropdownOpen}
                            className={clsx({"flex items-center justify-center": collapsed})}
                            menu={{
                                items: organizationMenuItems,
                                selectedKeys: selectedOrganizationKey,
                                onClick: handleOrganizationMenuClick,
                            }}
                        >
                            <div data-org-selector>
                                {renderSelectionButton(
                                    organizationButtonLabel,
                                    "Organization",
                                    organizationDropdownOpen,
                                    true,
                                    false,
                                )}
                            </div>
                        </Dropdown>
                    ) : (
                        <div className={clsx({"flex items-center justify-center": collapsed})}>
                            {renderSelectionButton(
                                organizationButtonLabel,
                                "Organization",
                                false,
                                false,
                                true,
                            )}
                        </div>
                    )}

                    {isPostSignupPage ? null : (
                        <ListOfProjects
                            collapsed={collapsed}
                            buttonProps={buttonProps}
                            interactive={interactive}
                            selectedOrganizationId={effectiveSelectedId}
                            dropdownProps={dropdownProps}
                        />
                    )}
                </>
            ) : null}

            <Modal
                title="Create Organization"
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
                        label="Name"
                        name="name"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="Organization name" autoFocus />
                    </Form.Item>
                    <Form.Item label="Description (optional)" name="description">
                        <Input.TextArea placeholder="Organization description" rows={3} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Rename Organization"
                open={isRenameModalOpen}
                okText="Save"
                onCancel={() => {
                    setRenameModalOpen(false)
                    setOrgToRename(null)
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
                        if (!orgToRename) return
                        renameMutation.mutate({
                            organizationId: orgToRename,
                            name: values.name,
                        })
                    }}
                >
                    <Form.Item
                        label="Organization name"
                        name="name"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="Organization name" autoFocus />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Transfer Ownership"
                open={isTransferModalOpen}
                okText="Transfer"
                onCancel={() => {
                    setTransferModalOpen(false)
                    setOrgToTransfer(null)
                    setNewOwnerId(null)
                }}
                onOk={() => {
                    console.log("🎯 Transfer modal OK clicked:", {
                        orgToTransfer,
                        newOwnerId,
                        newOwnerIdType: typeof newOwnerId,
                    })
                    if (!orgToTransfer || !newOwnerId) {
                        console.warn("⚠️ Missing orgToTransfer or newOwnerId")
                        return
                    }
                    transferMutation.mutate({
                        organizationId: orgToTransfer,
                        newOwnerId,
                    })
                }}
                confirmLoading={transferMutation.isPending}
                destroyOnHidden
                centered
            >
                <Form layout="vertical">
                    <Form.Item
                        label="Select New Owner"
                        required
                        tooltip="The new owner will have full administrative rights over the organization."
                    >
                        <Select
                            placeholder="Select a member"
                            showSearch
                            optionFilterProp="label"
                            options={transferOwnerOptions}
                            className="w-full"
                            value={newOwnerId}
                            onChange={(value) => {
                                console.log("👤 Select owner changed:", {
                                    value,
                                    valueType: typeof value,
                                    stringValue: String(value),
                                })
                                setNewOwnerId(String(value))
                            }}
                            filterOption={(input, option) =>
                                (option?.label ?? "")
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                            labelRender={(option) => {
                                const data = transferOwnerOptionByValue.get(
                                    String(option.value),
                                )
                                if (!data) return <span>{option.label}</span>
                                return (
                                    <div className="flex items-center gap-2 w-full min-w-0">
                                        <span className="truncate font-normal">
                                            {data.displayName}
                                        </span>
                                        {data.email && (
                                            <>
                                                <span className="text-gray-400">·</span>
                                                <span className="font-mono text-xs font-normal px-2 py-0.5 bg-gray-100 rounded shrink-0">
                                                    {data.email}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                )
                            }}
                            optionRender={(option, info) => {
                                const isLast =
                                    typeof info?.index === "number" &&
                                    info.index === transferOwnerOptionCount - 1
                                return (
                                    <div
                                        className={clsx(
                                            "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 py-2 px-2 w-full",
                                            !isLast && "border-b border-gray-100",
                                        )}
                                    >
                                        <Avatar size="small" name={option.data.displayName} />
                                        <span className="truncate font-normal">
                                            {option.data.displayName}
                                        </span>
                                        {option.data.email && (
                                            <span className="font-mono text-xs font-normal justify-self-end">
                                                {option.data.email}
                                            </span>
                                        )}
                                    </div>
                                )
                            }}
                        />
                    </Form.Item>
                </Form>
            </Modal>

        </div>
    )
}

export default memo(ListOfOrgs)
