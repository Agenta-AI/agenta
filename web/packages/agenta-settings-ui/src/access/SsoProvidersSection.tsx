import type {ReactNode} from "react"
import {useMemo} from "react"

import type {OrganizationProvider} from "@agenta/entities/organization"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

export interface SsoProvidersSectionProps {
    providers: OrganizationProvider[]
    loading?: boolean
    /** Builds the IdP redirect URI; it needs the org slug, so the host owns it. */
    callbackUrlFor?: (provider: OrganizationProvider) => string | null
    onAdd?: () => void
    /** SSO needs an org slug first, so the host may be offering to set that instead. */
    addLabel?: string
    onEdit?: (provider: OrganizationProvider) => void
    onEnable?: (provider: OrganizationProvider) => void
    onDelete?: (provider: OrganizationProvider) => void
    enabling?: boolean
    deleting?: boolean
    /** Setup detail under a provider that is not yet valid; copy affordances are the host's. */
    renderInstructions?: (provider: OrganizationProvider) => ReactNode
    /** The org-slug field and its warning sit between the heading and the table. */
    children?: ReactNode
}

/**
 * Both read the flag the BACKEND reads, the way it reads it. `EnableSsoUseCase` gates on
 * `(provider.flags or {}).get("is_active") and .get("is_valid")` — truthy, so an omitted flag
 * means NOT active. This used to test `is_enabled !== false`, which is both a different flag and
 * the opposite default: a provider the backend refuses to enable SSO with rendered here as
 * enabled and verified.
 */
const isEnabled = (provider: OrganizationProvider) => provider.flags?.is_active === true
const isValid = (provider: OrganizationProvider) => provider.flags?.is_valid === true

/** The identity providers members can sign in through. */
export const SsoProvidersSection = ({
    providers,
    loading = false,
    callbackUrlFor,
    onAdd,
    addLabel = "Add provider",
    onEdit,
    onEnable,
    onDelete,
    enabling,
    deleting,
    renderInstructions,
    children,
}: SsoProvidersSectionProps) => {
    const columns = useMemo<DataTableColumn<OrganizationProvider>[]>(
        () => [
            {key: "slug", title: "Provider", width: 200, render: (record) => record.slug},
            {
                key: "callback_url",
                title: "Callback URL",
                width: 320,
                mono: true,
                render: (record) => {
                    const url = callbackUrlFor?.(record)
                    if (!url) return <span className="text-colorTextSecondary">Set org slug</span>
                    return (
                        <span className="block truncate" title={url}>
                            {url}
                        </span>
                    )
                },
            },
            {
                key: "status",
                title: "Status",
                width: 140,
                render: (record) => {
                    if (!isEnabled(record)) return <StatusIndicator label="Disabled" />
                    return isValid(record) ? (
                        <StatusIndicator tone="success" label="Active" />
                    ) : (
                        <StatusIndicator tone="warning" label="Pending" />
                    )
                },
            },
            {
                key: "enable",
                title: "",
                width: 100,
                render: (record) =>
                    (!isEnabled(record) || !isValid(record)) && onEnable ? (
                        <Button size="sm" disabled={enabling} onClick={() => onEnable(record)}>
                            Enable
                        </Button>
                    ) : null,
            },
        ],
        [callbackUrlFor, onEnable, enabling],
    )

    const addButton = (variant?: "outline") =>
        onAdd ? (
            <Button variant={variant} onClick={onAdd} disabled={loading}>
                <Plus size={14} />
                {addLabel}
            </Button>
        ) : null

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="m-0 text-lg font-medium text-colorText">SSO Providers</h2>
                    <p className="m-0 mt-1 text-xs text-colorTextSecondary">
                        Configure identity providers for single sign-on
                    </p>
                </div>
                {addButton()}
            </div>

            {children}

            <DataTable<OrganizationProvider>
                columns={columns}
                rows={providers}
                rowKey={(record) => record.id}
                loading={loading}
                expandedContent={
                    renderInstructions
                        ? (record) => (isValid(record) ? null : renderInstructions(record))
                        : undefined
                }
                actions={(record) => [
                    {
                        key: "edit",
                        label: "Edit provider",
                        icon: <PencilSimpleLine size={16} />,
                        hidden: !onEdit,
                        onClick: () => onEdit?.(record),
                    },
                    {
                        key: "delete",
                        label: "Delete provider",
                        icon: <Trash size={16} />,
                        danger: true,
                        hidden: !onDelete,
                        disabled: deleting,
                        onClick: () => onDelete?.(record),
                    },
                ]}
                empty={
                    <EmptyState
                        image="simple"
                        description={
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-colorText">
                                    No SSO providers yet
                                </span>
                                <span>
                                    Add an OIDC provider to let members sign in with your identity
                                    provider.
                                </span>
                            </div>
                        }
                    >
                        {addButton("outline")}
                    </EmptyState>
                }
            />
        </section>
    )
}
