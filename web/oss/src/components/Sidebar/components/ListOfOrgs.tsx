import {memo, useEffect, useMemo, useRef, useState} from "react"

import {ArrowsLeftRight, CaretDown, PencilSimple, Trash} from "@phosphor-icons/react"
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
    Tag,
    message,
} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import Session from "supertokens-auth-react/recipe/session"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {isEE} from "@/oss/lib/helpers/isEE"
import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import {checkOrganizationAccess} from "@/oss/services/organization/api"
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
import {authFlowAtom} from "@/oss/state/session"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import Avatar from "../../Avatar/Avatar"

import AuthUpgradeModal, {AuthUpgradeDetail} from "./AuthUpgradeModal"
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
     * When false, organization items remain visible but are not actionable.
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
    const formatErrorMessage = (detail: any, fallback: string) => {
        if (typeof detail === "string") return detail
        if (detail && typeof detail.message === "string") return detail.message
        return fallback
    }
    const router = useRouter()
    const {user} = useProfileData()
    const {
        selectedOrg: selectedOrganization,
        orgs: organizations,
        changeSelectedOrg,
        refetch,
    } = useOrgData()
    const {members: workspaceMembers} = useWorkspaceMembers()
    const selectedOrganizationId = useAtomValue(selectedOrgIdAtom)
    const setAuthFlow = useSetAtom(authFlowAtom)
    const effectiveSelectedId =
        overrideOrganizationId || selectedOrganization?.id || selectedOrganizationId
    const organizationList = useAtomValue(organizationsAtom)
    const safeOrganizationList = Array.isArray(organizationList) ? organizationList : []
    const selectedBasicOrganization = useMemo(
        () =>
            safeOrganizationList.find((organization) => organization.id === effectiveSelectedId) ||
            null,
        [safeOrganizationList, effectiveSelectedId],
    )
    const {project} = useProjectData()
    const organizationLabel = isEE() ? "Organization" : "Agenta"
    const organizationDisplayName = isEE()
        ? selectedBasicOrganization?.name ||
          selectedOrganization?.name ||
          organizations?.[0]?.name ||
          organizationLabel
        : organizationLabel

    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [createForm] = Form.useForm<{name: string; description?: string}>()

    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [renameForm] = Form.useForm<{name: string}>()
    const [orgToRename, setOrgToRename] = useState<string | null>(null)

    const [isTransferModalOpen, setTransferModalOpen] = useState(false)
    const [orgToTransfer, setOrgToTransfer] = useState<string | null>(null)
    const [newOwnerId, setNewOwnerId] = useState<string | null>(null)
    const [authUpgradeOpen, setAuthUpgradeOpen] = useState(false)
    const [authUpgradeDetail, setAuthUpgradeDetail] = useState<AuthUpgradeDetail | null>(null)
    const [authUpgradeOrgId, setAuthUpgradeOrgId] = useState<string | null>(null)
    const lastDomainDeniedOrgIdRef = useRef<string | null>(null)
    const lastDomainDeniedAtRef = useRef<number>(0)
    const authUpgradeOrgKey = "authUpgradeOrgId"
    const transferOwnerOptions = useMemo(() => {
        const options = workspaceMembers
            .filter((member) => {
                // Only include actual members (not pending/expired invitations)
                const isActualMember = member.user?.status === "member"
                const hasValidId = member.user?.id && member.user.id !== user?.id
                return isActualMember && hasValidId
            })
            .map((member) => {
                const userId = member.user.id
                const email = member.user?.email ?? ""
                const displayName = member.user?.username || getUsernameFromEmail(email)
                const label = email ? `${displayName} ${email}` : displayName
                return {
                    value: userId,
                    label,
                    displayName,
                    email,
                }
            })
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
            const isDemo = organization.flags?.is_demo ?? false
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
                            {isPersonal && <Tag className="bg-[#0517290F] m-0">personal</Tag>}
                            {isDemo && <Tag className="bg-[#0517290F] m-0">demo</Tag>}
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

        // Only show "New Organization" in EE
        if (isEE()) {
            items.push({
                key: "create-organization",
                label: (
                    <div className="flex items-center gap-2 text-primary-500">
                        <span className="font-medium">+ New organization</span>
                    </div>
                ),
            })
        }

        return items
    }, [effectiveSelectedId, interactive, organizationSelectionEnabled, organizations, user?.id])

    const [organizationDropdownOpen, setOrganizationDropdownOpen] = useState(false)

    useEffect(() => {
        const handleOpenCreateOrganization = () => {
            setCreateModalOpen(true)
        }

        window.addEventListener("open-create-organization", handleOpenCreateOrganization)
        return () => {
            window.removeEventListener("open-create-organization", handleOpenCreateOrganization)
        }
    }, [])

    useEffect(() => {
        if (
            authUpgradeOpen &&
            authUpgradeOrgId &&
            effectiveSelectedId &&
            authUpgradeOrgId === effectiveSelectedId
        ) {
            setAuthUpgradeOpen(false)
            setAuthUpgradeDetail(null)
            setAuthUpgradeOrgId(null)
            setAuthFlow("authed")
            if (typeof window !== "undefined") {
                window.localStorage.removeItem(authUpgradeOrgKey)
                window.localStorage.removeItem("authUpgradeSessionIdentities")
            }
        }
    }, [authUpgradeOpen, authUpgradeOrgId, effectiveSelectedId])

    const organizationButtonLabel = organizationDisplayName
    const organizationCount = Array.isArray(organizations) ? organizations.length : 0
    const canSelectOrganizations = isEE() && organizationCount > 1

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
            console.error("[org] create failed", error)
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to create organization"))
        },
    })

    const renameMutation = useMutation({
        mutationFn: async ({organizationId, name}: {organizationId: string; name: string}) => {
            const {updateOrganization} = await import("@/oss/services/organization/api")
            return updateOrganization(organizationId, {name})
        },
        onSuccess: async () => {
            message.success("Organization renamed")
            renameForm.resetFields()
            setRenameModalOpen(false)
            setOrgToRename(null)
            await refetch()
        },
        onError: (error: any) => {
            console.error("[org] rename failed", error)
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to rename organization"))
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
            console.error("[org] delete failed", error)
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to delete organization"))
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
            const {transferOrganizationOwnership} = await import("@/oss/services/organization/api")
            const result = await transferOrganizationOwnership(organizationId, newOwnerId)
            return result
        },
        onSuccess: async () => {
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
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to transfer ownership"))
        },
    })

    const handleOrganizationMenuClick: MenuProps["onClick"] = ({key}) => {
        const keyString = key as string

        if (keyString === "create-organization") {
            setOrganizationDropdownOpen(false)
            setCreateModalOpen(true)
            return
        }

        // Handle copy ID action
        if (keyString.startsWith("copy:")) {
            const organizationId = keyString.split(":")[1]
            if (typeof navigator !== "undefined" && navigator?.clipboard) {
                navigator.clipboard
                    .writeText(organizationId)
                    .then(() => message.success("Organization ID copied"))
                    .catch(() => message.error("Failed to copy organization ID"))
            } else {
                message.error("Clipboard not supported")
            }
            setOrganizationDropdownOpen(false)
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
            if (organizationId === effectiveSelectedId) {
                setOrganizationDropdownOpen(false)
                return
            }
            setOrganizationDropdownOpen(false)
            void (async () => {
                try {
                    const result = await checkOrganizationAccess(organizationId)
                    if (result.ok) {
                        await changeSelectedOrg(organizationId)
                        return
                    }
                    console.error("[org] switch failed", result.response)
                    const detail = result.response?.data?.detail
                    if (
                        detail?.error === "AUTH_UPGRADE_REQUIRED" ||
                        detail?.error === "AUTH_SSO_DENIED"
                    ) {
                        setAuthUpgradeDetail(detail)
                        setAuthUpgradeOrgId(organizationId)
                        setAuthFlow("authing")
                        if (typeof window !== "undefined") {
                            window.localStorage.setItem(authUpgradeOrgKey, organizationId)
                            Session.getAccessTokenPayloadSecurely()
                                .then((payload) => {
                                    const sessionIdentities =
                                        payload?.session_identities ||
                                        payload?.sessionIdentities ||
                                        []
                                    console.debug("[auth-upgrade] captured session identities", {
                                        organizationId,
                                        sessionIdentities,
                                    })
                                    window.localStorage.setItem(
                                        "authUpgradeSessionIdentities",
                                        JSON.stringify(sessionIdentities),
                                    )
                                })
                                .catch(() => null)
                        }
                        setAuthUpgradeOpen(true)
                        return
                    }
                    if (detail?.error === "AUTH_DOMAIN_DENIED") {
                        const content =
                            typeof detail?.message === "string"
                                ? detail.message
                                : "Your email domain is not allowed for this organization."
                        const now = Date.now()
                        const recentlyNotified =
                            lastDomainDeniedOrgIdRef.current === organizationId &&
                            now - lastDomainDeniedAtRef.current < 2000
                        if (!recentlyNotified) {
                            lastDomainDeniedOrgIdRef.current = organizationId
                            lastDomainDeniedAtRef.current = now
                            message.error({
                                content,
                                key: "domain-denied",
                            })
                        }
                        return
                    }
                    const fallback = formatErrorMessage(
                        result.response?.data?.detail || result.response?.statusText,
                        "Unable to switch organization",
                    )
                    message.error(fallback)
                } catch (error: any) {
                    console.error("[org] switch failed", error)
                    message.error("Unable to switch organization")
                }
            })()
        }
    }

    const selectedOrganizationKey = effectiveSelectedId
        ? [`organization:${effectiveSelectedId}`]
        : undefined

    return (
        <div className={clsx("flex flex-col gap-2 px-2 py-3", {"items-center": collapsed})}>
            {canShow ? (
                <>
                    {interactive && canSelectOrganizations ? (
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
                                    organizationLabel,
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
                                organizationLabel,
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

            <AuthUpgradeModal
                open={authUpgradeOpen}
                organizationName={organizations.find((org) => org.id === authUpgradeOrgId)?.name}
                detail={authUpgradeDetail}
                onCancel={() => {
                    setAuthUpgradeOpen(false)
                    setAuthUpgradeDetail(null)
                    setAuthUpgradeOrgId(null)
                    setAuthFlow("authed")
                    if (typeof window !== "undefined") {
                        window.localStorage.removeItem(authUpgradeOrgKey)
                        window.localStorage.removeItem("authUpgradeSessionIdentities")
                    }
                }}
            />

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
                        label="Select new owner"
                        required
                        tooltip="The new owner will have full administrative rights over the organization."
                    >
                        <Select
                            placeholder="Select a member"
                            showSearch
                            optionFilterProp="label"
                            options={transferOwnerOptions}
                            className="w-full"
                            popupClassName="[&_.ant-select-item-option-content]:overflow-visible"
                            value={newOwnerId}
                            onChange={(value) => {
                                setNewOwnerId(String(value))
                            }}
                            filterOption={(input, option) =>
                                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                            }
                            labelRender={(option) => {
                                const data = transferOwnerOptionByValue.get(String(option.value))
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
                                            <span className="font-mono text-xs font-normal justify-self-end pr-2">
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
