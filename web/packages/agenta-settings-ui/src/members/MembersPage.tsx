import type {ReactNode} from "react"
import {useMemo} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {ArrowClockwise, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

interface MemberRow extends WorkspaceMember {
    key: string
}

const usernameFromEmail = (email?: string | null) => (email ? email.split("@")[0] : "")

export interface MembersPageProps {
    /** The full roster — this page owns the search filter so hosts cannot drift on it. */
    members: WorkspaceMember[]
    loading?: boolean
    searchTerm: string
    onSearchChange: (value: string) => void
    /** Identifies "You" and hides the destructive actions on your own row. */
    signedInUser?: {id?: string | null; email?: string | null} | null
    /** The owner cannot be removed. */
    ownerId?: string | null
    /** Roles are an EE/RBAC concern, and the cell itself is the host's (it writes). */
    renderRoleCell?: (member: WorkspaceMember) => ReactNode
    canInviteMembers?: boolean
    canRemoveMembers?: boolean
    /** Email currently being re-invited — disables that row's action. */
    resendingEmail?: string | null
    onInvite?: () => void
    onResendInvite?: (member: WorkspaceMember) => void
    onRemove?: (member: WorkspaceMember) => void
    onRenameSelf?: (member: WorkspaceMember) => void
    /** Invite / rename / invited-link dialogs — the host's. */
    children?: ReactNode
}

/**
 * The organization's members: who they are, their role, and where their invitation stands.
 *
 * A view only — the list, the search term and every verb come from the host, so a surface without
 * invite dialogs still renders the roster and its empty state.
 */
export const MembersPage = ({
    members,
    loading = false,
    searchTerm,
    onSearchChange,
    signedInUser,
    ownerId,
    renderRoleCell,
    canInviteMembers = false,
    canRemoveMembers = false,
    resendingEmail,
    onInvite,
    onResendInvite,
    onRemove,
    onRenameSelf,
    children,
}: MembersPageProps) => {
    const rows = useMemo<MemberRow[]>(() => {
        const term = searchTerm.trim().toLowerCase()
        const matching = term
            ? members.filter((member) =>
                  [member.user?.email, member.user?.username].some((value) =>
                      value?.toLowerCase().includes(term),
                  ),
              )
            : members
        return matching.map((member) => ({...member, key: member.user.id}))
    }, [members, searchTerm])

    const isSelf = (member: WorkspaceMember) =>
        member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email
    const isOwner = (member: WorkspaceMember) => Boolean(ownerId) && member.user?.id === ownerId

    const columns = useMemo<DataTableColumn<MemberRow>[]>(
        () => [
            {
                key: "member",
                title: "Member",
                width: 280,
                render: (record) => (
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">
                            {record.user.username || usernameFromEmail(record.user.email)}
                        </span>
                        {isSelf(record) ? <Tag>You</Tag> : null}
                        {/* Invitation state belongs beside the person; accepted members carry none. */}
                        {record.user?.status === "expired" ? <Tag>Expired</Tag> : null}
                        {record.user?.status === "pending" ? <Tag>Pending</Tag> : null}
                    </div>
                ),
            },
            {key: "email", title: "Email", width: 290, mono: true, render: (r) => r.user?.email},
            ...(renderRoleCell
                ? [
                      {
                          key: "roles",
                          title: "Role",
                          width: 160,
                          render: (record: MemberRow) => renderRoleCell(record),
                      } satisfies DataTableColumn<MemberRow>,
                  ]
                : []),
            {
                key: "created_at",
                title: "Added",
                width: 160,
                render: (record) =>
                    record.user.created_at ? formatDay({date: record.user.created_at}) : "-",
            },
        ],
        [renderRoleCell, signedInUser?.id, signedInUser?.email],
    )

    const inviteButton = (variant?: "outline") =>
        canInviteMembers && onInvite ? (
            <Button variant={variant} onClick={onInvite} disabled={loading}>
                <Plus size={14} />
                Invite members
            </Button>
        ) : null

    return (
        <div className="flex flex-col gap-2">
            <DataTable<MemberRow>
                columns={columns}
                rows={rows}
                rowKey={(record) => record.key}
                loading={loading}
                actions={(record) => [
                    {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilSimpleLine size={16} />,
                        hidden: !isSelf(record) || !onRenameSelf,
                        onClick: () => onRenameSelf?.(record),
                    },
                    {
                        key: "resend_invite",
                        label: "Resend invitation",
                        icon: <ArrowClockwise size={16} />,
                        hidden:
                            isSelf(record) ||
                            record.user.status === "member" ||
                            !canInviteMembers ||
                            !onResendInvite,
                        disabled: resendingEmail === record.user.email,
                        onClick: () => onResendInvite?.(record),
                    },
                    {
                        key: "remove",
                        label: "Remove",
                        icon: <Trash size={16} />,
                        danger: true,
                        hidden: isSelf(record) || isOwner(record) || !canRemoveMembers || !onRemove,
                        onClick: () => onRemove?.(record),
                    },
                ]}
                search={{
                    placeholder: "Search members",
                    value: searchTerm,
                    onChange: onSearchChange,
                    disabled: loading,
                }}
                primaryActions={inviteButton()}
                empty={
                    searchTerm.trim() ? (
                        <EmptyState
                            image="simple"
                            description={`No members match “${searchTerm.trim()}”`}
                        />
                    ) : (
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No members yet
                                    </span>
                                    <span>
                                        Invite people to collaborate in this organization.
                                        Invitations appear here until they are accepted or expire.
                                    </span>
                                </div>
                            }
                        >
                            {inviteButton("outline")}
                        </EmptyState>
                    )
                }
            />

            {children}
        </div>
    )
}
