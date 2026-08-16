import type {ReactNode} from "react"
import {useMemo} from "react"

import type {OrganizationDomain} from "@agenta/entities/organization"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {ArrowClockwise, Plus, Trash} from "@phosphor-icons/react"

/** An unverified domain's token stops being usable 48 hours after it was issued. */
const TOKEN_LIFETIME_MS = 48 * 60 * 60 * 1000

export interface DomainsSectionProps {
    domains: OrganizationDomain[]
    loading?: boolean
    onAdd?: () => void
    onVerify?: (domain: OrganizationDomain) => void
    onRefreshToken?: (domain: OrganizationDomain) => void
    onDelete?: (domain: OrganizationDomain) => void
    verifying?: boolean
    refreshing?: boolean
    deleting?: boolean
    /** Copy affordances differ per host, so the DNS rows are rendered by the caller. */
    renderInstructions?: (domain: OrganizationDomain) => ReactNode
}

/** Domains you have proven you own, and what is left to do for the ones you have not. */
export const DomainsSection = ({
    domains,
    loading = false,
    onAdd,
    onVerify,
    onRefreshToken,
    onDelete,
    verifying,
    refreshing,
    deleting,
    renderInstructions,
}: DomainsSectionProps) => {
    const columns = useMemo<DataTableColumn<OrganizationDomain>[]>(
        () => [
            {key: "slug", title: "Domain", width: 260, render: (record) => record.slug},
            {
                key: "expires_at",
                title: "Expiration",
                width: 220,
                render: (record) => {
                    if (record.flags?.is_verified) return "-"
                    // A `created_at` the browser cannot parse yields NaN, and the row rendered a
                    // literal "Invalid Date" that also compares false against every date — so it
                    // never read as expired either. Say we do not know instead.
                    const createdAt = new Date(record.created_at).getTime()
                    if (Number.isNaN(createdAt)) {
                        return <span className="text-colorTextSecondary">Unknown</span>
                    }
                    const expiresAt = new Date(createdAt + TOKEN_LIFETIME_MS)
                    const expired = new Date() > expiresAt
                    return (
                        <span className={expired ? "text-colorError" : "text-colorTextSecondary"}>
                            {expiresAt.toLocaleString()}
                            {expired ? " (Expired)" : ""}
                        </span>
                    )
                },
            },
            {
                key: "is_verified",
                title: "Status",
                width: 140,
                render: (record) =>
                    record.flags?.is_verified ? (
                        <StatusIndicator tone="success" label="Verified" />
                    ) : (
                        <StatusIndicator tone="warning" label="Pending" />
                    ),
            },
            {
                key: "verify",
                title: "",
                width: 100,
                render: (record) =>
                    !record.flags?.is_verified && onVerify ? (
                        <Button size="sm" disabled={verifying} onClick={() => onVerify(record)}>
                            Verify
                        </Button>
                    ) : null,
            },
        ],
        [onVerify, verifying],
    )

    return (
        <section className="flex flex-col gap-2">
            <div>
                <h2 className="m-0 text-lg font-medium text-colorText">Verified Domains</h2>
                <p className="m-0 mt-1 text-xs text-colorTextSecondary">
                    Prove you own a domain to auto-join its members and restrict invitations to it.
                </p>
            </div>

            <DataTable<OrganizationDomain>
                columns={columns}
                rows={domains}
                rowKey={(record) => record.id}
                loading={loading}
                expandedContent={
                    renderInstructions
                        ? (record) =>
                              record.flags?.is_verified || !record.token
                                  ? null
                                  : renderInstructions(record)
                        : undefined
                }
                actions={(record) => [
                    {
                        key: "refresh",
                        label: "Refresh token",
                        icon: <ArrowClockwise size={16} />,
                        hidden: Boolean(record.flags?.is_verified) || !onRefreshToken,
                        disabled: refreshing,
                        onClick: () => onRefreshToken?.(record),
                    },
                    {
                        key: "delete",
                        label: "Delete domain",
                        icon: <Trash size={16} />,
                        danger: true,
                        hidden: !onDelete,
                        disabled: deleting,
                        onClick: () => onDelete?.(record),
                    },
                ]}
                primaryActions={
                    onAdd ? (
                        <Button onClick={onAdd} disabled={loading}>
                            <Plus size={14} />
                            Add domain
                        </Button>
                    ) : null
                }
                empty={
                    <EmptyState
                        image="simple"
                        description={
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-colorText">
                                    No domains yet
                                </span>
                                <span>
                                    Add a domain and publish its DNS record to verify that you own
                                    it.
                                </span>
                            </div>
                        }
                    >
                        {onAdd ? (
                            <Button variant="outline" onClick={onAdd}>
                                <Plus size={14} />
                                Add domain
                            </Button>
                        ) : null}
                    </EmptyState>
                }
            />
        </section>
    )
}
