import {useCallback, useMemo, useState} from "react"

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
import {EnhancedModal} from "@agenta/ui/components/modal"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash, WarningCircle} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

interface ConnectionRow extends ProviderConnection {
    key: string
    [extra: string]: unknown
}

/**
 * Settings → AI providers.
 *
 * One table of CONNECTIONS, not of providers: a project may hold two OpenAI keys, and each is its
 * own row with its own name, models, and harnesses. Clicking a row opens that connection's card
 * directly; "Add provider" opens the same drawer at the catalog. No toasts anywhere in the flow —
 * the card carries its own errors, and a removal that fails says so under the table it happened in.
 * Removal itself confirms in the same modal the other settings tables use.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Settings page").
 */
const AIProviders = () => {
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    const [drawerOpen, setDrawerOpen] = useState(false)
    const [selected, setSelected] = useState<ProviderConnection | null>(null)
    const [pendingRemoval, setPendingRemoval] = useState<ProviderConnection | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const rows = useMemo<ConnectionRow[]>(
        () => connections.map((connection) => ({...connection, key: connection.id})),
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
        } catch {
            // No toast anywhere in this flow: the failure is stated under the table it happened in,
            // which is why the confirmation closes either way.
            setRemoveError(`Agenta could not remove ${pendingRemoval.name}. Try again.`)
        } finally {
            setRemoving(false)
            setPendingRemoval(null)
        }
    }, [deleteSecret, mutate, pendingRemoval])

    const columns = useMemo(
        () =>
            createStandardColumns<ConnectionRow>([
                {
                    type: "text",
                    key: "kind",
                    title: "Provider",
                    width: 200,
                    fixed: "left",
                    render: (_value, record) => {
                        const Icon = providerIconFor(record.kind)
                        return (
                            <div className="flex min-w-0 items-center gap-2">
                                <Icon className="h-5 w-5 shrink-0" />
                                <span className="truncate">{record.title}</span>
                            </div>
                        )
                    },
                },
                {type: "text", key: "name", title: "Name", width: 200},
                {
                    type: "text",
                    key: "credential",
                    title: "Credential",
                    width: 220,
                    render: (_value, record) => (
                        <span className="font-mono text-xs">{credentialSummary(record)}</span>
                    ),
                },
                {
                    type: "text",
                    key: "models",
                    title: "Active models",
                    width: 180,
                    render: (_value, record) => activeModelsSummary(record, capabilities),
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Created",
                    width: 170,
                    render: (_value, record) =>
                        record.createdAt
                            ? formatDay({date: record.createdAt, outputFormat: "YYYY-MM-DD HH:mm"})
                            : "-",
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: ConnectionRow) => openConnection(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: ConnectionRow) => setPendingRemoval(record),
                        },
                    ],
                } satisfies StandardColumnDef<ConnectionRow>,
            ]),
        [capabilities, openConnection],
    )

    const {tableScope, pagination} = useStaticTable<ConnectionRow>("settings-ai-providers", rows, {
        loading,
    })

    return (
        <>
            <section className="flex flex-col gap-2">
                <InfiniteVirtualTableFeatureShell<ConnectionRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    columns={columns}
                    rowKey="key"
                    pagination={pagination}
                    // Fixed height sized to row count; autoHeight would grow unbounded here.
                    autoHeight={false}
                    rowHeight={40}
                    primaryActions={
                        <Button icon={<Plus size={14} />} type="primary" onClick={openCatalog}>
                            Add provider
                        </Button>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        onRow: (record) => ({
                            className: "cursor-pointer",
                            onClick: () => openConnection(record),
                        }),
                        locale: {
                            emptyText: (
                                <EmptyState
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs font-medium text-colorText">
                                                No providers connected
                                            </span>
                                            <span>
                                                Connect a provider with your own API key to run
                                                agents, prompts, and evaluations.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button icon={<Plus size={14} />} onClick={openCatalog}>
                                        Add provider
                                    </Button>
                                </EmptyState>
                            ),
                        },
                    }}
                />

                {removeError ? (
                    <span className="flex items-center gap-1 text-xs text-colorError">
                        <WarningCircle size={14} />
                        {removeError}
                    </span>
                ) : null}

                <Typography.Text type="secondary" className="text-xs">
                    Claude and ChatGPT subscriptions are detected by the runner from your
                    deployment&apos;s mounted login folder and are not listed here.{" "}
                    <a href={SUBSCRIPTION_DOCS_URL} target="_blank" rel="noreferrer">
                        Set one up
                    </a>
                    .
                </Typography.Text>
            </section>

            <EnhancedModal
                title="Are you sure you want to delete?"
                open={!!pendingRemoval}
                okText="Delete"
                okType="danger"
                okButtonProps={{icon: <Trash size={14} className="mt-0.5" />, type: "primary"}}
                classNames={{footer: "flex items-center justify-end"}}
                confirmLoading={removing}
                onOk={() => void removeConnection()}
                onCancel={() => setPendingRemoval(null)}
            >
                <div className="flex flex-col gap-4">
                    <Typography.Text>
                        This action is not reversible. Agents and prompts using this connection stop
                        working.
                    </Typography.Text>

                    <div className="flex flex-col gap-1">
                        <Typography.Text>You are about to delete:</Typography.Text>
                        <Typography.Text className="text-sm font-medium">
                            {pendingRemoval?.name}
                        </Typography.Text>
                    </div>
                </div>
            </EnhancedModal>

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
                subscriptionDocsUrl={SUBSCRIPTION_DOCS_URL}
            />
        </>
    )
}

export default AIProviders
