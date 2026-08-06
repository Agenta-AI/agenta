import {useCallback, useMemo, useState, type FC} from "react"

import {message} from "@agenta/ui/app-message"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type EntityChip,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {EditOutlined} from "@ant-design/icons"
import {ArrowClockwise, Plus, Trash} from "@phosphor-icons/react"
import {Button, Input, Modal} from "antd"
import dynamic from "next/dynamic"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {isEmailInvitationsEnabled, isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {updateUsername} from "@/oss/services/profile"
import {removeFromWorkspace, resendInviteToWorkspace} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import {Roles} from "./cellRenderers"

interface MemberRow extends WorkspaceMember {
    key: string
    [extra: string]: unknown
}

/**
 * Invitation state belongs beside the person, not stacked under a date. Members that have
 * accepted carry no chip at all.
 */
const memberChips = (member: WorkspaceMember, isSelf: boolean): EntityChip[] => {
    const chips: EntityChip[] = []
    if (isSelf) chips.push({label: "You", tone: "info"})

    const status = member.user?.status
    if (status && status !== "member") {
        chips.push(
            status === "expired"
                ? {label: "Expired", tone: "error", variant: "status"}
                : {label: "Pending", tone: "warning", variant: "status"},
        )
    }
    return chips
}

const InvitedUserLinkModal = dynamic(() => import("./Modals/InvitedUserLinkModal"), {ssr: false})
const InviteUsersModal = dynamic(() => import("./Modals/InviteUsersModal"), {ssr: false})

const WorkspaceManage: FC = () => {
    const {user: signedInUser, refetch: refetchProfile} = useProfileData()
    const {selectedOrg, loading, refetch} = useOrgData()
    const {filteredMembers, searchTerm, setSearchTerm} = useWorkspaceMembers()
    const {hasRBAC} = useEntitlements()
    const {canInviteMembers, canRemoveMembers} = useWorkspacePermissions()
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInvitedUserLinkModalOpen, setIsInvitedUserLinkModalOpen] = useState(false)
    const [invitedUserData, setInvitedUserData] = useState<{email: string; uri: string}>({
        email: "",
        uri: "",
    })
    const [queryInviteModalOpen, setQueryInviteModalOpen] = useQueryParam("inviteModal")
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState("")
    const [resendingEmail, setResendingEmail] = useState<string | null>(null)

    const organizationId = selectedOrg?.id
    const workspaceId = selectedOrg?.default_workspace?.id

    const rows = useMemo<MemberRow[]>(
        () => filteredMembers.map((member) => ({...member, key: member.user.id})),
        [filteredMembers],
    )

    const isSelfMember = useCallback(
        (record: MemberRow) =>
            record.user?.id === signedInUser?.id || record.user?.email === signedInUser?.email,
        [signedInUser?.id, signedInUser?.email],
    )
    const isOwnerMember = useCallback(
        (record: MemberRow) => record.user?.id === selectedOrg?.owner_id,
        [selectedOrg?.owner_id],
    )

    const handleResendInvite = useCallback(
        (record: MemberRow) => {
            const {user} = record
            if (!organizationId || !user.email || !workspaceId) return
            setResendingEmail(user.email)
            resendInviteToWorkspace({organizationId, workspaceId, email: user.email})
                .then((res) => {
                    if (!isEmailInvitationsEnabled() && typeof res.url === "string") {
                        setInvitedUserData({email: user.email!, uri: res.url})
                        setIsInvitedUserLinkModalOpen(true)
                    } else {
                        message.success("Invitation sent!")
                    }
                })
                .then(() => refetch())
                .catch(console.error)
                .finally(() => setResendingEmail(null))
        },
        [organizationId, workspaceId, refetch],
    )

    const handleRemove = useCallback(
        (record: MemberRow) => {
            const {user} = record
            if (!organizationId || !user.email || !workspaceId) return
            AlertPopup({
                title: "Remove member",
                message: `Are you sure you want to remove ${user.username} from this workspace?`,
                okText: "Remove",
                onOk: () =>
                    removeFromWorkspace(
                        {organizationId, workspaceId, email: user.email},
                        true,
                    ).then(() => refetch()),
            })
        },
        [organizationId, workspaceId, refetch],
    )

    const handleRename = useCallback(async () => {
        const nextValue = renameValue.trim()
        if (!nextValue) {
            message.error("Username is required.")
            return
        }
        try {
            await updateUsername(nextValue)
            await Promise.all([refetchProfile(), refetch()])
            message.success("Username updated")
            setRenameOpen(false)
        } catch (error: any) {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to update username"
            message.error(detail)
        }
    }, [renameValue, refetchProfile, refetch])

    const columns = useMemo(
        () =>
            createStandardColumns<MemberRow>([
                {
                    type: "entity",
                    key: "member",
                    title: "Member",
                    width: 280,
                    getName: (record) =>
                        record.user.username || getUsernameFromEmail(record.user.email),
                    getChips: (record) =>
                        memberChips(record, record.user?.email === signedInUser?.email),
                },
                {
                    type: "slug",
                    key: "email",
                    title: "Email",
                    width: 290,
                    getValue: (record) => record.user?.email,
                },
                ...(!isEE() || hasRBAC
                    ? [
                          {
                              type: "text",
                              key: "roles",
                              title: "Role",
                              width: 160,
                              render: (_value: unknown, record: MemberRow) => (
                                  <Roles
                                      member={record}
                                      signedInUser={signedInUser!}
                                      organizationId={organizationId!}
                                      workspaceId={workspaceId!}
                                  />
                              ),
                          } satisfies StandardColumnDef<MemberRow>,
                      ]
                    : []),
                {
                    type: "text",
                    key: "created_at",
                    title: "Added",
                    width: 160,
                    render: (_value, record) => formatDay({date: record.user.created_at}),
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "rename",
                            label: "Rename",
                            icon: <EditOutlined />,
                            hidden: (record) => !isSelfMember(record),
                            onClick: (record) => {
                                setRenameValue(record.user.username || "")
                                setRenameOpen(true)
                            },
                        },
                        {
                            key: "resend_invite",
                            label: "Resend invitation",
                            icon: <ArrowClockwise size={16} />,
                            hidden: (record) =>
                                isSelfMember(record) ||
                                record.user.status === "member" ||
                                !canInviteMembers,
                            disabled: (record) => resendingEmail === record.user.email,
                            onClick: (record) => handleResendInvite(record),
                        },
                        {
                            key: "remove",
                            label: "Remove",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: (record) =>
                                isSelfMember(record) || isOwnerMember(record) || !canRemoveMembers,
                            onClick: (record) => handleRemove(record),
                        },
                    ],
                } satisfies StandardColumnDef<MemberRow>,
            ] as StandardColumnDef<MemberRow>[]),
        [
            hasRBAC,
            organizationId,
            selectedOrg?.owner_id,
            signedInUser,
            workspaceId,
            isSelfMember,
            isOwnerMember,
            canInviteMembers,
            canRemoveMembers,
            resendingEmail,
            handleResendInvite,
            handleRemove,
        ],
    )

    const {tableScope, pagination} = useStaticTable<MemberRow>("settings-members", rows)
    return (
        <div className="flex flex-col gap-2">
            <InfiniteVirtualTableFeatureShell<MemberRow>
                tableScope={tableScope}
                autoHeight={false}
                columns={columns}
                rowKey={(record) => record.user.id}
                filters={
                    <Input.Search
                        placeholder="Search members"
                        className="w-[260px]"
                        allowClear
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                }
                primaryActions={
                    canInviteMembers ? (
                        <Button
                            type="primary"
                            icon={<Plus size={14} />}
                            onClick={() => setIsInviteModalOpen(true)}
                        >
                            Invite members
                        </Button>
                    ) : null
                }
                pagination={pagination}
                tableProps={{
                    size: "small",
                    bordered: true,
                    tableLayout: "fixed",
                    loading,
                    locale: {
                        emptyText: searchTerm.trim() ? (
                            <EmptyState
                                className="py-12"
                                image="simple"
                                description={`No members match “${searchTerm.trim()}”`}
                            />
                        ) : (
                            <EmptyState
                                className="py-12"
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-base font-semibold text-colorText">
                                            No members yet
                                        </span>
                                        <span>
                                            Invite people to collaborate in this workspace.
                                            Invitations appear here until they are accepted or
                                            expire.
                                        </span>
                                    </div>
                                }
                            >
                                {canInviteMembers ? (
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={() => setIsInviteModalOpen(true)}
                                    >
                                        Invite members
                                    </Button>
                                ) : null}
                            </EmptyState>
                        ),
                    },
                }}
            />

            <Modal
                title="Rename your username"
                open={renameOpen}
                okText="Save"
                onCancel={() => setRenameOpen(false)}
                onOk={handleRename}
                destroyOnHidden
                centered
            >
                <Input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    placeholder="New username"
                />
            </Modal>

            <InviteUsersModal
                setQueryInviteModalOpen={setQueryInviteModalOpen}
                open={queryInviteModalOpen === "open" || isInviteModalOpen}
                onCancel={() => setIsInviteModalOpen(false)}
                workspaceId={workspaceId!}
                onSuccess={(data) => {
                    if (!isEmailInvitationsEnabled() && data?.uri) {
                        setInvitedUserData(data)
                        setIsInvitedUserLinkModalOpen(true)
                    }
                }}
            />
            {!isEmailInvitationsEnabled() && (
                <InvitedUserLinkModal
                    open={isInvitedUserLinkModalOpen}
                    onCancel={() => {
                        setIsInvitedUserLinkModalOpen(false)
                        refetch()
                    }}
                    invitedUserData={invitedUserData}
                />
            )}
        </div>
    )
}

export default WorkspaceManage
