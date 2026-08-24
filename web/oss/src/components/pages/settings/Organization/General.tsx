import {useCallback, useMemo, useState} from "react"

import type {Org, OrgDetails} from "@agenta/entities/organization"
import {
    createOrganization,
    deleteOrganization,
    transferOrganizationOwnership,
    updateOrganization,
} from "@agenta/entities/organization"
import {OrganizationsPage} from "@agenta/settings-ui"
import {InitialsAvatar} from "@agenta/ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {App, Form, Input, Select, Typography} from "antd"
import clsx from "clsx"

import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import {resetOrganizationData, useOrgData} from "@/oss/state/org"
import {clearWorkspaceOrgCache} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {resetProjectData} from "@/oss/state/project"
import {clearLastUsedProjectId} from "@/oss/state/project/selectors/project"
import {useWorkspaceMembers} from "@/oss/state/workspace"

const formatErrorMessage = (detail: unknown, fallback: string) => {
    if (typeof detail === "string") return detail
    if (detail && typeof (detail as {message?: unknown}).message === "string") {
        return (detail as {message: string}).message
    }
    return fallback
}

/** OSS binding: the shared organizations table with this app's antd dialogs. */
const OrganizationGeneral = () => {
    const {message} = App.useApp()
    const {orgs, selectedOrg, changeSelectedOrg, refetch, loading} = useOrgData()
    const {user} = useProfileData()
    const {members: workspaceMembers} = useWorkspaceMembers()

    const [searchTerm, setSearchTerm] = useState("")
    const [activeOrg, setActiveOrg] = useState<Org | null>(null)
    const [isCreateModalOpen, setCreateModalOpen] = useState(false)
    const [isRenameModalOpen, setRenameModalOpen] = useState(false)
    const [isTransferModalOpen, setTransferModalOpen] = useState(false)
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false)
    const [newOwnerId, setNewOwnerId] = useState<string | null>(null)
    const [deleteConfirmInput, setDeleteConfirmInput] = useState("")

    const [createForm] = Form.useForm<{name: string}>()
    const [renameForm] = Form.useForm<{name: string}>()

    const isDeleteNameMatch =
        Boolean(activeOrg?.name) && deleteConfirmInput === (activeOrg?.name ?? "")

    const transferOwnerOptions = useMemo(
        () =>
            workspaceMembers
                .filter(
                    (member) =>
                        member.user?.status === "member" &&
                        member.user?.id &&
                        member.user.id !== user?.id,
                )
                .map((member) => {
                    const email = member.user?.email ?? ""
                    const displayName = member.user?.username || getUsernameFromEmail(email)
                    return {
                        value: member.user.id,
                        label: email ? `${displayName} ${email}` : displayName,
                        displayName,
                        email,
                    }
                }),
        [workspaceMembers, user?.id],
    )

    const transferOwnerOptionByValue = useMemo(() => {
        const map = new Map<string, (typeof transferOwnerOptions)[number]>()
        transferOwnerOptions.forEach((option) => map.set(String(option.value), option))
        return map
    }, [transferOwnerOptions])

    const selectedNewOwner = newOwnerId ? transferOwnerOptionByValue.get(newOwnerId) : undefined

    const createMutation = useMutation({
        mutationFn: ({name}: {name: string}) => createOrganization({name}),
        onSuccess: async () => {
            message.success("Organization created")
            createForm.resetFields()
            setCreateModalOpen(false)
            await refetch()
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to create organization"))
        },
    })

    const renameMutation = useMutation({
        mutationFn: ({id, name}: {id: string; name: string}) => updateOrganization(id, {name}),
        onSuccess: async () => {
            message.success("Organization renamed")
            setRenameModalOpen(false)
            setActiveOrg(null)
            await refetch()
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to rename organization"))
        },
    })

    const transferMutation = useMutation({
        mutationFn: ({id, ownerId}: {id: string; ownerId: string}) =>
            transferOrganizationOwnership(id, ownerId),
        onSuccess: async () => {
            message.success("Ownership transferred")
            setTransferModalOpen(false)
            setNewOwnerId(null)
            setActiveOrg(null)
            await refetch()
            resetOrganizationData()
            resetProjectData()
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to transfer ownership"))
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteOrganization(id),
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to delete organization"))
        },
    })

    const handleDelete = useCallback(async () => {
        if (!activeOrg?.id || !isDeleteNameMatch) return

        // antd hands onOk straight to the OK button's onClick, so a rejection here would
        // escape as an unhandled promise; the mutation's onError already surfaces it.
        try {
            await deleteMutation.mutateAsync(activeOrg.id)
        } catch {
            return
        }
        message.success("Organization deleted")

        // Latent: GET /organizations list omits default_workspace (details-only field).
        const deletedWorkspaceId =
            activeOrg.id === selectedOrg?.id
                ? ((selectedOrg as Partial<OrgDetails> | undefined)?.default_workspace?.id ?? null)
                : null
        clearWorkspaceOrgCache(deletedWorkspaceId)
        clearLastUsedProjectId(deletedWorkspaceId)

        const remainingOrgs = (orgs ?? []).filter((org) => org.id !== activeOrg.id)
        if (activeOrg.id === selectedOrg?.id && remainingOrgs.length > 0) {
            await changeSelectedOrg(remainingOrgs[0].id)
        }

        resetOrganizationData()
        resetProjectData()
        await refetch()

        setDeleteModalOpen(false)
        setDeleteConfirmInput("")
        setActiveOrg(null)
    }, [
        activeOrg,
        changeSelectedOrg,
        deleteMutation,
        isDeleteNameMatch,
        message,
        orgs,
        refetch,
        selectedOrg,
    ])

    return (
        <OrganizationsPage
            organizations={orgs ?? []}
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedOrgId={selectedOrg?.id}
            currentUserId={user?.id}
            onSwitch={(org) => changeSelectedOrg(org.id)}
            onCreate={() => setCreateModalOpen(true)}
            onRename={(org) => {
                setActiveOrg(org)
                renameForm.setFieldsValue({name: org.name ?? ""})
                setRenameModalOpen(true)
            }}
            onTransferOwnership={(org) => {
                setActiveOrg(org)
                setNewOwnerId(null)
                setTransferModalOpen(true)
            }}
            onLeave={() => message.info("Ask an organization owner to remove you from Members.")}
            onDelete={(org) => {
                setActiveOrg(org)
                setDeleteConfirmInput("")
                setDeleteModalOpen(true)
            }}
        >
            <EnhancedModal
                title="New organization"
                open={isCreateModalOpen}
                okText="Create"
                onCancel={() => {
                    setCreateModalOpen(false)
                    createForm.resetFields()
                }}
                onOk={() => createForm.submit()}
                confirmLoading={createMutation.isPending}
            >
                <Form
                    form={createForm}
                    layout="vertical"
                    onFinish={({name}) => createMutation.mutate({name: name.trim()})}
                >
                    <Form.Item
                        label="Organization name"
                        name="name"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="e.g. Acme AI" autoFocus />
                    </Form.Item>
                </Form>
            </EnhancedModal>

            <EnhancedModal
                title="Rename organization"
                open={isRenameModalOpen}
                okText="Save"
                onCancel={() => {
                    setRenameModalOpen(false)
                    setActiveOrg(null)
                    renameForm.resetFields()
                }}
                onOk={() => renameForm.submit()}
                confirmLoading={renameMutation.isPending}
            >
                <Form
                    form={renameForm}
                    layout="vertical"
                    onFinish={({name}) => {
                        if (!activeOrg) return
                        renameMutation.mutate({id: activeOrg.id, name: name.trim()})
                    }}
                >
                    <Form.Item
                        label="Organization name"
                        name="name"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="Organization name" />
                    </Form.Item>
                </Form>
            </EnhancedModal>

            <EnhancedModal
                title="Transfer ownership"
                open={isTransferModalOpen}
                okText="Transfer"
                okButtonProps={{disabled: !newOwnerId}}
                onCancel={() => {
                    setTransferModalOpen(false)
                    setActiveOrg(null)
                    setNewOwnerId(null)
                }}
                onOk={() => {
                    if (!newOwnerId || !activeOrg) return
                    transferMutation.mutate({id: activeOrg.id, ownerId: newOwnerId})
                }}
                confirmLoading={transferMutation.isPending}
                width={450}
            >
                <div className="flex flex-col gap-3">
                    <Select
                        placeholder={
                            transferOwnerOptions.length
                                ? "Select a member"
                                : "No other members to transfer to"
                        }
                        showSearch
                        optionFilterProp="label"
                        options={transferOwnerOptions}
                        disabled={!transferOwnerOptions.length}
                        popupClassName="[&_.ant-select-item-option-content]:overflow-visible"
                        value={newOwnerId}
                        onChange={(value) => setNewOwnerId(value ? String(value) : null)}
                        filterOption={(input, option) =>
                            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                        }
                        labelRender={(option) => {
                            const data = transferOwnerOptionByValue.get(String(option.value))
                            if (!data) return <span>{option.label}</span>
                            return (
                                <div className="flex w-full min-w-0 items-center gap-2">
                                    <span className="truncate font-normal">{data.displayName}</span>
                                    {data.email ? (
                                        <span className="shrink-0 rounded bg-colorFillQuaternary px-2 py-0.5 font-mono text-xs font-normal">
                                            {data.email}
                                        </span>
                                    ) : null}
                                </div>
                            )
                        }}
                        optionRender={(option, info) => {
                            const isLast = info?.index === transferOwnerOptions.length - 1
                            return (
                                <div
                                    className={clsx(
                                        "grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2",
                                        !isLast &&
                                            "border-0 border-b border-solid border-colorBorderSecondary",
                                    )}
                                >
                                    <InitialsAvatar size="small" name={option.data.displayName} />
                                    <span className="truncate font-normal">
                                        {option.data.displayName}
                                    </span>
                                    {option.data.email ? (
                                        <span className="justify-self-end pr-2 font-mono text-xs font-normal">
                                            {option.data.email}
                                        </span>
                                    ) : null}
                                </div>
                            )
                        }}
                    />
                    <Typography.Paragraph className="!mb-0">
                        {selectedNewOwner?.displayName ?? "The new owner"} gains full administrative
                        rights over <Typography.Text strong>{activeOrg?.name}</Typography.Text>. You
                        keep your membership but lose owner access.
                    </Typography.Paragraph>
                </div>
            </EnhancedModal>

            <EnhancedModal
                title="Delete organization"
                open={isDeleteModalOpen}
                okText="Delete organization"
                okType="danger"
                okButtonProps={{
                    icon: <Trash size={14} />,
                    type: "primary",
                    disabled: !isDeleteNameMatch,
                }}
                onCancel={() => {
                    if (deleteMutation.isPending) return
                    setDeleteModalOpen(false)
                    setDeleteConfirmInput("")
                    setActiveOrg(null)
                }}
                onOk={handleDelete}
                confirmLoading={deleteMutation.isPending}
                width={450}
            >
                <div className="flex flex-col gap-3">
                    <div className="rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-3">
                        <div className="flex flex-col gap-1">
                            <Typography.Text strong className="!text-[var(--ant-color-error)]">
                                This action cannot be undone.
                            </Typography.Text>
                            <Typography.Paragraph className="!mb-0 text-[var(--ant-color-text)]">
                                Permanently deletes{" "}
                                <Typography.Text strong>{activeOrg?.name}</Typography.Text>,
                                including all workspaces, projects, applications, and data.
                            </Typography.Paragraph>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-[var(--ant-color-text)]">
                            <span>Type</span>
                            <Typography.Text
                                code
                                className="!border-[var(--ant-color-error-border)] !bg-[var(--ant-color-error-bg)] !text-[var(--ant-color-error)]"
                            >
                                {activeOrg?.name}
                            </Typography.Text>
                            <span>to confirm:</span>
                        </div>
                        <Input
                            value={deleteConfirmInput}
                            onChange={(event) => setDeleteConfirmInput(event.target.value)}
                            placeholder="Organization name"
                            autoComplete="off"
                            spellCheck={false}
                            status={deleteConfirmInput && !isDeleteNameMatch ? "error" : undefined}
                            autoFocus
                        />
                    </div>
                </div>
            </EnhancedModal>
        </OrganizationsPage>
    )
}

export default OrganizationGeneral
