import type {ReactNode} from "react"

import type {OrganizationDomain} from "@agenta/entities/organization"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, Globe, Plus, Trash} from "@phosphor-icons/react"

import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {SettingsToolbar} from "../shared/SettingsToolbar"

/** An unverified domain's token stops being usable 48 hours after it was issued. */
const TOKEN_LIFETIME_MS = 48 * 60 * 60 * 1000

const COLUMNS: ListTableColumn[] = [
    {key: "slug", label: "Domain", width: "minmax(180px,2fr)"},
    {key: "expires_at", label: "Expiration", width: "minmax(160px,1.4fr)"},
    {key: "is_verified", label: "Status", width: "minmax(96px,1fr)"},
    {key: "verify", label: "Verify", srOnly: true, width: "72px"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

const ExpirationCell = ({domain}: {domain: OrganizationDomain}) => {
    if (domain.flags?.is_verified) return <span className="text-muted-foreground">-</span>
    // An unparseable `created_at` is NaN, which reads as neither expired nor live: say so.
    const createdAt = new Date(domain.created_at).getTime()
    if (Number.isNaN(createdAt)) return <span className="text-muted-foreground">Unknown</span>
    const expiresAt = new Date(createdAt + TOKEN_LIFETIME_MS)
    const expired = new Date() > expiresAt
    return (
        <span className={expired ? "truncate text-destructive" : "truncate text-muted-foreground"}>
            {expiresAt.toLocaleString()}
            {expired ? " (Expired)" : ""}
        </span>
    )
}

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
    const addButton = (variant?: "outline") =>
        onAdd ? (
            <Button size="sm" variant={variant} onClick={onAdd} disabled={loading}>
                <Plus size={14} />
                Add domain
            </Button>
        ) : null

    return (
        <section className="flex flex-col">
            <div className="mb-3">
                <h2 className="m-0 text-[13px] font-medium leading-[18px] text-muted-foreground">
                    Verified Domains
                </h2>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                    Prove you own a domain to auto-join its members and restrict invitations to it.
                </p>
            </div>

            <SettingsToolbar actions={addButton()} />
            <ListTable<OrganizationDomain>
                columns={COLUMNS}
                groups={[{key: "all", label: null, rows: domains}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.id}
                minWidth={600}
                loading={loading && domains.length === 0}
                hideHeader={!loading && domains.length === 0}
                empty={
                    <SettingsEmpty
                        icon={<Globe size={18} />}
                        title="No domains yet"
                        description="Add a domain and publish its DNS record to verify that you own it."
                        action={addButton("outline")}
                    />
                }
                renderRow={(record) => {
                    const verified = Boolean(record.flags?.is_verified)
                    const instructions =
                        renderInstructions && !verified && record.token
                            ? renderInstructions(record)
                            : null
                    return (
                        <>
                            <span className="truncate font-medium text-foreground">
                                {record.slug}
                            </span>
                            <ExpirationCell domain={record} />
                            {verified ? (
                                <StatusIndicator tone="success" label="Verified" />
                            ) : (
                                <StatusIndicator tone="warning" label="Pending" />
                            )}
                            <span className="flex justify-end">
                                {!verified && onVerify ? (
                                    <Button
                                        size="sm"
                                        disabled={verifying}
                                        onClick={() => onVerify(record)}
                                    >
                                        Verify
                                    </Button>
                                ) : null}
                            </span>
                            <SettingsRowMenu
                                label="Domain actions"
                                items={[
                                    {
                                        key: "refresh",
                                        label: "Refresh token",
                                        icon: <ArrowClockwise size={14} />,
                                        hidden: verified || !onRefreshToken,
                                        disabled: refreshing,
                                        onClick: () => onRefreshToken?.(record),
                                    },
                                    {
                                        key: "delete",
                                        label: "Delete domain",
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !onDelete,
                                        disabled: deleting,
                                        onClick: () => onDelete?.(record),
                                    },
                                ]}
                            />
                            {instructions ? (
                                <div className="col-span-full">{instructions}</div>
                            ) : null}
                        </>
                    )
                }}
            />
        </section>
    )
}
