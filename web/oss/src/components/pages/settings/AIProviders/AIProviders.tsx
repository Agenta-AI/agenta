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
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {Plus, Trash, WarningCircle} from "@phosphor-icons/react"
import {Button, Popconfirm, Typography} from "antd"
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
 * directly; "Add provider" opens the same drawer at the catalog. No modals and no toasts anywhere
 * in the flow — the card carries its own errors, and removal confirms in place.
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
    const [removingId, setRemovingId] = useState<string | null>(null)
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

    const removeConnection = useCallback(
        async (connection: ProviderConnection) => {
            setRemovingId(connection.id)
            setRemoveError(null)
            try {
                await deleteSecret(connection.source)
                mutate()
            } catch {
                // No toast anywhere in this flow: the failure is stated under the table it happened in.
                setRemoveError(`Agenta could not remove ${connection.name}. Try again.`)
            } finally {
                setRemovingId(null)
            }
        },
        [deleteSecret, mutate],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<ConnectionRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Provider",
                    width: 280,
                    fixed: "left",
                    render: (_value, record) => {
                        const Icon = providerIconFor(record.kind)
                        return (
                            <div className="flex min-w-0 items-center gap-2">
                                <Icon className="h-5 w-5 shrink-0" />
                                <span className="truncate">{record.name}</span>
                            </div>
                        )
                    },
                },
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
                    title: "Connected",
                    width: 170,
                    render: (_value, record) =>
                        record.createdAt
                            ? formatDay({date: record.createdAt, outputFormat: "YYYY-MM-DD HH:mm"})
                            : "-",
                },
                {
                    type: "text",
                    key: "actions",
                    title: "",
                    width: 160,
                    fixed: "right",
                    render: (_value, record) => (
                        // The row opens the card; the actions cell must not, or Remove opens it too.
                        <div onClick={(event) => event.stopPropagation()}>
                            <Popconfirm
                                title="Remove key"
                                description="Agents and prompts using this connection stop working."
                                okText="Remove"
                                okType="danger"
                                cancelText="Cancel"
                                onConfirm={() => void removeConnection(record)}
                            >
                                <Button
                                    danger
                                    type="text"
                                    size="small"
                                    icon={<Trash size={16} />}
                                    loading={removingId === record.id}
                                >
                                    Remove key
                                </Button>
                            </Popconfirm>
                        </div>
                    ),
                } satisfies StandardColumnDef<ConnectionRow>,
            ]),
        [capabilities, removeConnection, removingId],
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
