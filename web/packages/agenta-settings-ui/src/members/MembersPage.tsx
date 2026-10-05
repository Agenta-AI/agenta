import {useMemo, type ReactNode} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {InitialsAvatar, StatusIndicator, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    Key,
    MagnifyingGlass,
    PencilSimpleLine,
    Plus,
    Trash,
    Users,
} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {SettingsToolbar} from "../shared/SettingsToolbar"

interface MemberRow extends WorkspaceMember {
    key: string
}

const MEMBER_COLUMN: ListTableColumn = {
    key: "member",
    label: "Member",
    width: "minmax(220px,2fr)",
}
const ROLE_COLUMN: ListTableColumn = {key: "roles", label: "Role", width: "minmax(120px,1fr)"}
const TAIL_COLUMNS: ListTableColumn[] = [
    {key: "status", label: "Status", width: "minmax(96px,1fr)"},
    {key: "created_at", label: "Added", width: "minmax(96px,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]

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
    /** Admin-only: mint a password reset link for another member. */
    canResetPassword?: boolean
    /** Email currently being re-invited — disables that row's action. */
    resendingEmail?: string | null
    onInvite?: () => void
    onResendInvite?: (member: WorkspaceMember) => void
    onRemove?: (member: WorkspaceMember) => void
    onRenameSelf?: (member: WorkspaceMember) => void
    onResetPassword?: (member: WorkspaceMember) => void
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
    canResetPassword = false,
    resendingEmail,
    onInvite,
    onResendInvite,
    onRemove,
    onRenameSelf,
    onResetPassword,
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

    const columns = useMemo(
        () => [MEMBER_COLUMN, ...(renderRoleCell ? [ROLE_COLUMN] : []), ...TAIL_COLUMNS],
        [renderRoleCell],
    )

    const inviteButton = (variant?: "outline") =>
        canInviteMembers && onInvite ? (
            <Button variant={variant} onClick={onInvite} disabled={loading}>
                <Plus size={14} />
                Invite members
            </Button>
        ) : null

    const searching = searchTerm.trim().length > 0

    return (
        <div className="flex flex-col">
            <SettingsPageActions>{inviteButton()}</SettingsPageActions>
            <SettingsToolbar
                search={{
                    placeholder: "Search members",
                    value: searchTerm,
                    onChange: onSearchChange,
                }}
            />
            <ListTable<MemberRow>
                columns={columns}
                groups={[{key: "all", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={renderRoleCell ? 700 : 580}
                loading={loading && rows.length === 0}
                hideHeader={!loading && rows.length === 0}
                empty={
                    searching ? (
                        <SettingsEmpty
                            icon={<MagnifyingGlass size={18} />}
                            title={`No members match “${searchTerm.trim()}”`}
                            action={
                                <Button variant="outline" onClick={() => onSearchChange("")}>
                                    Clear search
                                </Button>
                            }
                        />
                    ) : (
                        <SettingsEmpty
                            icon={<Users size={18} />}
                            title="No members yet"
                            description="Invite people to collaborate in this organization. Invitations appear here until they are accepted or expire."
                            action={inviteButton("outline")}
                        />
                    )
                }
                renderRow={(record) => {
                    const name = record.user.username || usernameFromEmail(record.user.email)
                    const status = record.user?.status
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <InitialsAvatar shape="circle" name={name} />
                                <div className="flex min-w-0 flex-col">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className="truncate font-medium text-foreground"
                                            title={name}
                                        >
                                            {name}
                                        </span>
                                        {isSelf(record) ? (
                                            <Tag
                                                size="small"
                                                tone="info"
                                                label="You"
                                                className="shrink-0"
                                            />
                                        ) : null}
                                    </div>
                                    <span className="truncate text-[12.5px] text-muted-foreground">
                                        {record.user?.email}
                                    </span>
                                </div>
                            </div>
                            {renderRoleCell ? (
                                <div className="min-w-0 font-medium text-foreground">
                                    {renderRoleCell(record)}
                                </div>
                            ) : null}
                            {status === "expired" ? (
                                <StatusIndicator tone="error" label="Expired" />
                            ) : status === "pending" ? (
                                <StatusIndicator tone="warning" label="Pending" />
                            ) : (
                                <StatusIndicator tone="success" label="Active" />
                            )}
                            <span className="truncate text-muted-foreground">
                                {record.user.created_at
                                    ? formatDay({date: record.user.created_at})
                                    : "-"}
                            </span>
                            <SettingsRowMenu
                                label="Member actions"
                                items={[
                                    {
                                        key: "rename",
                                        label: "Rename",
                                        icon: <PencilSimpleLine size={14} />,
                                        hidden: !isSelf(record) || !onRenameSelf,
                                        onClick: () => onRenameSelf?.(record),
                                    },
                                    {
                                        key: "resend_invite",
                                        label: "Resend invitation",
                                        icon: <ArrowClockwise size={14} />,
                                        hidden:
                                            isSelf(record) ||
                                            record.user.status === "member" ||
                                            !canInviteMembers ||
                                            !onResendInvite,
                                        disabled: resendingEmail === record.user.email,
                                        onClick: () => onResendInvite?.(record),
                                    },
                                    {
                                        key: "reset_password",
                                        label: "Reset password",
                                        icon: <Key size={14} />,
                                        // The owner is excluded even though the backend has no such check:
                                        // resetting their password would mint a login link into that account.
                                        hidden:
                                            isSelf(record) ||
                                            isOwner(record) ||
                                            record.user.status !== "member" ||
                                            !canResetPassword ||
                                            !onResetPassword,
                                        onClick: () => onResetPassword?.(record),
                                    },
                                    {
                                        key: "remove",
                                        label: "Remove",
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden:
                                            isSelf(record) ||
                                            isOwner(record) ||
                                            !canRemoveMembers ||
                                            !onRemove,
                                        onClick: () => onRemove?.(record),
                                    },
                                ]}
                            />
                        </>
                    )
                }}
            />

            {children}
        </div>
    )
}
