import {useCallback, useMemo, useState} from "react"

import {InitialsAvatar} from "@agenta/ui"
import {ArrowsLeftRight, Trash} from "@phosphor-icons/react"
import {useMutation} from "@tanstack/react-query"
import {App, Button, Form, Input, Select, Typography} from "antd"
import clsx from "clsx"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import type {OrgDetails} from "@/oss/lib/Types"
import {
    deleteOrganization,
    transferOrganizationOwnership,
    updateOrganization,
} from "@/oss/services/organization/api"
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

interface SettingsSectionProps {
    title: string
    description: string
    children: React.ReactNode
}

const SettingsSection = ({title, description, children}: SettingsSectionProps) => (
    <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
            <Typography.Title level={5} className="!mb-0">
                {title}
            </Typography.Title>
            <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
        {children}
    </section>
)

const OrganizationGeneral = () => {
    const {message} = App.useApp()
    const {selectedOrg, orgs, changeSelectedOrg, refetch} = useOrgData()
    const {user} = useProfileData()
    const {members: workspaceMembers} = useWorkspaceMembers()

    const organizationId = selectedOrg?.id ?? ""
    const organizationName = selectedOrg?.name ?? ""

    const [renameForm] = Form.useForm<{name: string}>()
    const [newOwnerId, setNewOwnerId] = useState<string | null>(null)
    const [isTransferModalOpen, setTransferModalOpen] = useState(false)
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deleteConfirmInput, setDeleteConfirmInput] = useState("")

    const isDeleteNameMatch = Boolean(organizationName) && deleteConfirmInput === organizationName

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

    const renameMutation = useMutation({
        mutationFn: ({name}: {name: string}) => updateOrganization(organizationId, {name}),
        onSuccess: async () => {
            message.success("Organization renamed")
            await refetch()
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to rename organization"))
        },
    })

    const transferMutation = useMutation({
        mutationFn: ({ownerId}: {ownerId: string}) =>
            transferOrganizationOwnership(organizationId, ownerId),
        onSuccess: async () => {
            message.success("Ownership transferred")
            setTransferModalOpen(false)
            setNewOwnerId(null)
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
        mutationFn: () => deleteOrganization(organizationId),
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to delete organization"))
        },
    })

    const handleDelete = useCallback(async () => {
        if (!organizationId || !isDeleteNameMatch) return

        // antd hands onOk straight to the OK button's onClick, so a rejection here would
        // escape as an unhandled promise; the mutation's onError already surfaces it.
        try {
            await deleteMutation.mutateAsync()
        } catch {
            return
        }
        message.success("Organization deleted")

        // Latent: GET /organizations list omits default_workspace (details-only field) — typed as-is.
        const deletedWorkspaceId =
            (selectedOrg as Partial<OrgDetails> | undefined)?.default_workspace?.id || null
        clearWorkspaceOrgCache(deletedWorkspaceId)
        clearLastUsedProjectId(deletedWorkspaceId)

        const remainingOrgs = orgs.filter((org) => org.id !== organizationId)
        if (remainingOrgs.length > 0) {
            await changeSelectedOrg(remainingOrgs[0].id)
        }

        resetOrganizationData()
        resetProjectData()
        await refetch()

        setDeleteModalOpen(false)
        setDeleteConfirmInput("")
    }, [
        changeSelectedOrg,
        deleteMutation,
        isDeleteNameMatch,
        message,
        organizationId,
        orgs,
        refetch,
        selectedOrg,
    ])

    return (
        <div className="flex max-w-[640px] flex-col gap-8">
            <SettingsSection
                title="Organization name"
                description="This name appears in the sidebar and anywhere your organization is referenced."
            >
                <Form
                    form={renameForm}
                    layout="vertical"
                    // Remount on org switch so the field shows the organization you are looking at.
                    key={organizationId}
                    initialValues={{name: organizationName}}
                    onFinish={({name}) => renameMutation.mutate({name: name.trim()})}
                    className="flex items-start gap-2"
                >
                    <Form.Item
                        name="name"
                        className="!mb-0 flex-1"
                        rules={[{required: true, message: "Please enter an organization name"}]}
                    >
                        <Input placeholder="Organization name" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={renameMutation.isPending}>
                        Save
                    </Button>
                </Form>
            </SettingsSection>

            <SettingsSection
                title="Transfer ownership"
                description="Hand this organization to another member. They get full administrative rights and you lose them."
            >
                <div className="flex items-start gap-2">
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
                        className="flex-1"
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
                                        <>
                                            <span className="text-gray-400">·</span>
                                            <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 font-mono text-xs font-normal">
                                                {data.email}
                                            </span>
                                        </>
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
                                        !isLast && "border-b border-gray-100",
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
                    <Button
                        icon={<ArrowsLeftRight size={14} />}
                        disabled={!newOwnerId}
                        onClick={() => setTransferModalOpen(true)}
                    >
                        Transfer
                    </Button>
                </div>
            </SettingsSection>

            <SettingsSection
                title="Delete organization"
                description="Permanently delete this organization and everything inside it."
            >
                <div className="flex flex-col gap-3 rounded-lg border border-[var(--ant-color-error-border)] bg-[var(--ant-color-error-bg)] px-4 py-3">
                    <div className="flex flex-col gap-1">
                        <Typography.Text strong className="!text-[var(--ant-color-error)]">
                            This action cannot be undone.
                        </Typography.Text>
                        <Typography.Paragraph className="!mb-0 text-[var(--ant-color-text)]">
                            Deletes {organizationName || "this organization"}, including all
                            workspaces, projects, applications, and data.
                        </Typography.Paragraph>
                    </div>
                    <div>
                        <Button
                            danger
                            type="primary"
                            icon={<Trash size={14} />}
                            disabled={!organizationId}
                            onClick={() => {
                                setDeleteConfirmInput("")
                                setDeleteModalOpen(true)
                            }}
                        >
                            Delete organization
                        </Button>
                    </div>
                </div>
            </SettingsSection>

            <EnhancedModal
                title="Transfer ownership"
                open={isTransferModalOpen}
                okText="Transfer"
                onCancel={() => setTransferModalOpen(false)}
                onOk={() => {
                    if (!newOwnerId) return
                    transferMutation.mutate({ownerId: newOwnerId})
                }}
                confirmLoading={transferMutation.isPending}
                width={450}
            >
                <Typography.Paragraph className="!mb-0">
                    {selectedNewOwner?.displayName ?? "This member"} becomes the owner of{" "}
                    <Typography.Text strong>{organizationName}</Typography.Text> and gains full
                    administrative rights. You keep your membership but lose owner access.
                </Typography.Paragraph>
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
                                <Typography.Text strong>{organizationName}</Typography.Text>,
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
                                {organizationName}
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
        </div>
    )
}

export default OrganizationGeneral
