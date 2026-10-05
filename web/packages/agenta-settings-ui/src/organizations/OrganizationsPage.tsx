import {useMemo, type ReactNode} from "react"

import type {Org} from "@agenta/entities/organization"
import {InitialsAvatar, Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {
    ArrowsLeftRight,
    Buildings,
    PencilSimpleLine,
    Plus,
    SignOut,
    Trash,
} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

interface OrgRow extends Org {
    key: string
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Organization", width: "minmax(200px,2fr)"},
    {key: "id", label: "Organization ID", width: "minmax(220px,2fr)"},
    {key: "owner_id", label: "Your role", width: "minmax(96px,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

export interface OrganizationsPageProps {
    /** Every organization you belong to. */
    organizations: Org[]
    loading?: boolean
    /** Marks the "Current" row and scopes the ownership transfer. */
    selectedOrgId?: string | null
    currentUserId?: string | null
    onSwitch?: (org: Org) => void
    onCreate?: () => void
    onRename?: (org: Org) => void
    onTransferOwnership?: (org: Org) => void
    onLeave?: (org: Org) => void
    onDelete?: (org: Org) => void
    /** Create / rename / transfer / delete dialogs — the host's. */
    children?: ReactNode
}

/**
 * The organizations you belong to, which one you are in, and what you can do to each.
 *
 * A view only: the list and every verb come from the host, so a surface that brings no dialogs
 * still renders the list and its empty state.
 */
export const OrganizationsPage = ({
    organizations,
    loading = false,
    selectedOrgId,
    currentUserId,
    onSwitch,
    onCreate,
    onRename,
    onTransferOwnership,
    onLeave,
    onDelete,
    children,
}: OrganizationsPageProps) => {
    const rows = useMemo<OrgRow[]>(
        () => organizations.map((org) => ({...org, key: org.id})),
        [organizations],
    )

    const isOwner = (org: Org) => Boolean(currentUserId) && org.owner_id === currentUserId

    const createButton = (variant?: "outline") =>
        onCreate ? (
            <Button size="sm" variant={variant} onClick={onCreate} disabled={loading}>
                <Plus size={14} />
                New organization
            </Button>
        ) : null

    return (
        <div className="flex flex-col">
            <SettingsPageActions>{createButton()}</SettingsPageActions>
            <ListTable<OrgRow>
                columns={COLUMNS}
                groups={[{key: "all", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.key}
                minWidth={640}
                loading={loading && rows.length === 0}
                hideHeader={!loading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={<Buildings size={18} />}
                        title="No organizations yet"
                        description="An organization groups your workspaces, projects and the people who work in them."
                        action={createButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const name = record.name ?? record.slug ?? record.id
                    return (
                        <>
                            <div className="flex min-w-0 items-center gap-2.5">
                                <InitialsAvatar name={name} />
                                <span className="truncate font-medium text-foreground" title={name}>
                                    {name}
                                </span>
                                {record.id === selectedOrgId ? (
                                    <Tag className="shrink-0">Current</Tag>
                                ) : null}
                            </div>
                            <span className="truncate font-mono text-[13px] text-muted-foreground">
                                {record.id}
                            </span>
                            <span className="truncate">{isOwner(record) ? "Owner" : "Member"}</span>
                            <SettingsRowMenu
                                label="Organization actions"
                                items={[
                                    {
                                        key: "switch",
                                        label: "Switch to this organization",
                                        icon: <ArrowsLeftRight size={14} />,
                                        hidden: record.id === selectedOrgId || !onSwitch,
                                        onClick: () => onSwitch?.(record),
                                    },
                                    {
                                        key: "rename",
                                        label: "Rename",
                                        icon: <PencilSimpleLine size={14} />,
                                        hidden: !isOwner(record) || !onRename,
                                        onClick: () => onRename?.(record),
                                    },
                                    {
                                        key: "transfer",
                                        label: "Transfer ownership",
                                        icon: <ArrowsLeftRight size={14} />,
                                        // The member list is scoped to the current organization.
                                        hidden:
                                            !isOwner(record) ||
                                            record.id !== selectedOrgId ||
                                            !onTransferOwnership,
                                        onClick: () => onTransferOwnership?.(record),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "leave",
                                        label: "Leave organization",
                                        icon: <SignOut size={14} />,
                                        danger: true,
                                        hidden: isOwner(record) || !onLeave,
                                        onClick: () => onLeave?.(record),
                                    },
                                    {
                                        key: "delete",
                                        label: "Delete organization",
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !isOwner(record) || !onDelete,
                                        onClick: () => onDelete?.(record),
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
