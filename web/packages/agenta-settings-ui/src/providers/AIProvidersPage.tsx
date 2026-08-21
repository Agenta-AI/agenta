import {type ReactNode, useCallback, useMemo, useState} from "react"

import {
    activeModelsSummary,
    credentialSummary,
    deleteSecretAtom,
    providerConnectionsAtom,
    useVaultSecret,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {ProviderDrawer, providerIconFor} from "@agenta/entity-ui/secretProvider"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

export const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** What the host needs to render its own confirm chrome; the page owns the removal itself. */
export interface ProviderRemovalState {
    connection: ProviderConnection | null
    open: boolean
    pending: boolean
    error: string | null
    onConfirm: () => void
    onClose: () => void
}

export interface AIProvidersPageProps {
    /**
     * Removal confirmation. The page runs the delete and tracks pending/error; the host only
     * supplies the surface — a modal on desktop, a bottom sheet on mobile. Without one the
     * delete verb hides rather than going dead.
     */
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    /** Where "configured in the deployment" points. */
    subscriptionDocsUrl?: string
}

interface ConnectionRow extends ProviderConnection {
    key: string
}

/**
 * Settings → AI providers.
 *
 * One table of CONNECTIONS, not of providers: a project may hold two OpenAI keys, and each is its
 * own row with its own name, models, and harnesses. Clicking a row opens that connection's card
 * directly; "Add provider" opens the same drawer at the catalog. No toasts anywhere in the flow —
 * the card carries its own errors, and a removal that fails says so under the table it happened in.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Settings page").
 */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
}: AIProvidersPageProps) => {
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    const [drawerOpen, setDrawerOpen] = useState(false)
    const [selected, setSelected] = useState<ProviderConnection | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const canRemove = Boolean(renderRemoveDialog)

    // A connection Agenta provisioned is not the user's to edit or remove — the API answers 409 —
    // so it is not listed here. It stays in `providerConnectionsAtom`, which is what the composer
    // gate and the model pickers count: hiding the row must not make the project look keyless,
    // which is also why the drawer below still receives the unfiltered list.
    const rows = useMemo<ConnectionRow[]>(
        () =>
            connections
                .filter((connection) => !connection.managedBy)
                .map((connection) => ({...connection, key: connection.id})),
        [connections],
    )

    const openCatalog = useCallback(() => {
        setSelected(null)
        setDrawerOpen(true)
    }, [])

    const openConnection = useCallback((connection: ProviderConnection) => {
        setSelected(connection)
        setDrawerOpen(true)
    }, [])

    const removeConnection = useCallback(async () => {
        if (!pendingRemoval) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await deleteSecret(pendingRemoval.source)
            mutate()
            setPendingRemoval(null)
        } catch {
            // No toast anywhere in this flow: the failure is stated under the table it happened in.
            setRemoveError(`Agenta could not remove ${pendingRemoval.name}. Try again.`)
            setPendingRemoval(null)
        } finally {
            setRemoving(false)
        }
    }, [deleteSecret, mutate, pendingRemoval])

    const columns = useMemo<DataTableColumn<ConnectionRow>[]>(
        () => [
            {
                key: "kind",
                title: "Provider",
                width: 200,
                render: (record) => {
                    const Icon = providerIconFor(record.kind)
                    return (
                        <div className="flex min-w-0 items-center gap-2">
                            <Icon className="size-5 shrink-0" />
                            <span className="truncate">{record.title}</span>
                        </div>
                    )
                },
            },
            {
                key: "name",
                title: "Name",
                width: 200,
                render: (record) => <span className="truncate">{record.name}</span>,
            },
            {
                key: "credential",
                title: "Credential",
                width: 220,
                render: (record) => (
                    <span className="font-mono text-xs">{credentialSummary(record)}</span>
                ),
            },
            {
                key: "models",
                title: "Active models",
                width: 180,
                render: (record) => activeModelsSummary(record, capabilities),
            },
            {
                key: "created_at",
                title: "Created",
                width: 170,
                render: (record) =>
                    record.createdAt
                        ? formatDay({date: record.createdAt, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [capabilities],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <DataTable<ConnectionRow>
                    className="ph-no-capture"
                    columns={columns}
                    rows={rows}
                    rowKey={(record) => record.key}
                    loading={loading}
                    onRowClick={openConnection}
                    actions={(record) => [
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: () => openConnection(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: !canRemove,
                            onClick: () => {
                                setRemoveError(null)
                                setPendingRemoval(record)
                            },
                        },
                    ]}
                    primaryActions={
                        <Button disabled={loading} onClick={openCatalog}>
                            <Plus size={14} />
                            Add provider
                        </Button>
                    }
                    empty={
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No providers connected
                                    </span>
                                    <span>
                                        Connect a provider with your own API key to run agents,
                                        prompts, and evaluations.
                                    </span>
                                </div>
                            }
                        >
                            <Button variant="outline" onClick={openCatalog}>
                                <Plus size={14} />
                                Add provider
                            </Button>
                        </EmptyState>
                    }
                />

                {removeError ? (
                    <span className="flex items-center gap-1 text-xs text-colorError">
                        <WarningCircle size={14} />
                        {removeError}
                    </span>
                ) : null}

                <p className="m-0 text-xs text-colorTextSecondary">
                    Claude and ChatGPT subscriptions are detected by the runner from your
                    deployment&apos;s mounted login folder and are not listed here.{" "}
                    <a href={subscriptionDocsUrl} target="_blank" rel="noreferrer">
                        Set one up
                    </a>
                    .
                </p>
            </section>

            {renderRemoveDialog?.({
                connection: pendingRemoval,
                open: !!pendingRemoval,
                pending: removing,
                error: removeError,
                onConfirm: () => void removeConnection(),
                onClose: () => setPendingRemoval(null),
            })}

            <ProviderDrawer
                open={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false)
                    setSelected(null)
                }}
                context="settings"
                connections={connections}
                connection={selected}
                onSaved={mutate}
                subscriptionDocsUrl={subscriptionDocsUrl}
            />
        </>
    )
}
