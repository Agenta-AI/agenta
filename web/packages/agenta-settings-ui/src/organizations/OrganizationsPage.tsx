import type {ReactNode} from "react"
import {useMemo} from "react"

import type {Org} from "@agenta/entities/organization"
import {InitialsAvatar, Tag} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {ArrowsLeftRight, PencilSimpleLine, Plus, SignOut, Trash} from "@phosphor-icons/react"

interface OrgRow extends Org {
    key: string
}

export interface OrganizationsPageProps {
    /** Every organization you belong to; this page owns the search filter. */
    organizations: Org[]
    loading?: boolean
    searchTerm: string
    onSearchChange: (value: string) => void
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
    searchTerm,
    onSearchChange,
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
    const rows = useMemo<OrgRow[]>(() => {
        const term = searchTerm.trim().toLowerCase()
        const matching = term
            ? organizations.filter((org) =>
                  [org.name, org.id].some((value) => value?.toLowerCase().includes(term)),
              )
            : organizations
        return matching.map((org) => ({...org, key: org.id}))
    }, [organizations, searchTerm])

    const isOwner = (org: Org) => Boolean(currentUserId) && org.owner_id === currentUserId

    const columns = useMemo<DataTableColumn<OrgRow>[]>(
        () => [
            {
                key: "name",
                title: "Organization",
                width: 280,
                render: (record) => {
                    const name = record.name ?? record.slug ?? record.id
                    return (
                        <div className="flex min-w-0 items-center gap-2">
                            {/* The identity column carries an avatar on every other settings
                                table; the extraction dropped it here and on Projects. */}
                            <InitialsAvatar size="small" name={name} />
                            <span className="truncate font-medium" title={name}>
                                {name}
                            </span>
                            {record.id === selectedOrgId ? <Tag>Current</Tag> : null}
                        </div>
                    )
                },
            },
            // Its own copyable column, not a tag beside the page title.
            {key: "id", title: "Organization ID", width: 330, mono: true, render: (r) => r.id},
            {
                key: "owner_id",
                title: "Your role",
                width: 140,
                render: (record) => (isOwner(record) ? "Owner" : "Member"),
            },
        ],
        [selectedOrgId, currentUserId],
    )

    const createButton = (variant?: "outline") =>
        onCreate ? (
            <Button variant={variant} onClick={onCreate} disabled={loading}>
                <Plus size={14} />
                New organization
            </Button>
        ) : null

    return (
        <div className="flex flex-col gap-2">
            <DataTable<OrgRow>
                columns={columns}
                rows={rows}
                rowKey={(record) => record.key}
                loading={loading}
                actions={(record) => [
                    {
                        key: "switch",
                        label: "Switch to this organization",
                        icon: <ArrowsLeftRight size={16} />,
                        hidden: record.id === selectedOrgId || !onSwitch,
                        onClick: () => onSwitch?.(record),
                    },
                    {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilSimpleLine size={16} />,
                        hidden: !isOwner(record) || !onRename,
                        onClick: () => onRename?.(record),
                    },
                    {
                        key: "transfer",
                        label: "Transfer ownership",
                        icon: <ArrowsLeftRight size={16} />,
                        // The member list is scoped to the current organization.
                        hidden:
                            !isOwner(record) || record.id !== selectedOrgId || !onTransferOwnership,
                        onClick: () => onTransferOwnership?.(record),
                    },
                    {type: "divider"},
                    {
                        key: "leave",
                        label: "Leave organization",
                        icon: <SignOut size={16} />,
                        danger: true,
                        hidden: isOwner(record) || !onLeave,
                        onClick: () => onLeave?.(record),
                    },
                    {
                        key: "delete",
                        label: "Delete organization",
                        icon: <Trash size={16} />,
                        danger: true,
                        hidden: !isOwner(record) || !onDelete,
                        onClick: () => onDelete?.(record),
                    },
                ]}
                search={{
                    placeholder: "Search organizations",
                    value: searchTerm,
                    onChange: onSearchChange,
                    disabled: loading,
                }}
                primaryActions={createButton()}
                empty={
                    searchTerm.trim() ? (
                        <EmptyState
                            image="simple"
                            description={`No organizations match “${searchTerm.trim()}”`}
                        />
                    ) : (
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No organizations yet
                                    </span>
                                    <span>
                                        An organization groups your workspaces, projects and the
                                        people who work in them.
                                    </span>
                                </div>
                            }
                        >
                            {createButton("outline")}
                        </EmptyState>
                    )
                }
            />

            {children}
        </div>
    )
}
