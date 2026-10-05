import {useMemo, useState, type ReactNode} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {StatusIndicator, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, Key, PencilSimpleLine, Plus, Trash, Users} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {InlineName} from "../shared/InlineName"
import {NameAvatar} from "../shared/NameAvatar"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

interface MemberRow extends WorkspaceMember {
    key: string
}

const MEMBER_COLUMN: ListTableColumn = {
    key: "member",
    label: "Member",
    width: "minmax(0,2fr)",
}
const ROLE_COLUMN: ListTableColumn = {key: "roles", label: "Role", width: "minmax(0,1fr)"}
const TAIL_COLUMNS: ListTableColumn[] = [
    {key: "status", label: "Status", width: "minmax(0,1fr)"},
    {key: "created_at", label: "Added", width: "minmax(0,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]

const usernameFromEmail = (email?: string | null) => (email ? email.split("@")[0] : "")

export interface MembersPageProps {
    members: WorkspaceMember[]
    loading?: boolean
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
    /** Save a new username for your own row, renamed in place; throw to report a failure. */
    onRenameSelf?: (member: WorkspaceMember, name: string) => Promise<unknown>
    onResetPassword?: (member: WorkspaceMember) => void
    /** Invite / rename / invited-link dialogs — the host's. */
    children?: ReactNode
}

/**
 * The organization's members: who they are, their role, and where their invitation stands.
 *
 * A view only — the list and every verb come from the host, so a surface without
 * invite dialogs still renders the roster and its empty state.
 */
export const MembersPage = ({
    members,
    loading = false,
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
    const [renamingSelf, setRenamingSelf] = useState(false)
    const rows = useMemo<MemberRow[]>(
        () => members.map((member) => ({...member, key: member.user.id})),
        [members],
    )

    const isSelf = (member: WorkspaceMember) =>
        member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email
    const canRenameSelf = (member: WorkspaceMember) => Boolean(onRenameSelf) && isSelf(member)
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

    return (
        <div className="flex flex-col">
            <SettingsPageActions>{inviteButton()}</SettingsPageActions>
            <ListTable<MemberRow>
                columns={columns}
                groups={[{key: "all", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={0}
                loading={loading && rows.length === 0}
                hideHeader={!loading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={<Users size={18} />}
                        title="No members yet"
                        description="Invite people to collaborate in this organization. Invitations appear here until they are accepted or expire."
                        action={inviteButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const name = record.user.username || usernameFromEmail(record.user.email)
                    const status = record.user?.status
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <NameAvatar name={name} />
                                <div className="flex min-w-0 flex-col">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <InlineName
                                            value={name}
                                            editing={renamingSelf && canRenameSelf(record)}
                                            ariaLabel="Username"
                                            onStart={
                                                canRenameSelf(record)
                                                    ? () => setRenamingSelf(true)
                                                    : undefined
                                            }
                                            onDone={() => setRenamingSelf(false)}
                                            onSave={(next) => onRenameSelf!(record, next)}
                                        />
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
                                        hidden: !canRenameSelf(record),
                                        deferred: true,
                                        onClick: () => setRenamingSelf(true),
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
