import {useCallback, useEffect, useMemo, useState} from "react"

import {
    fetchToolConnection,
    isConnectionActive,
    isConnectionValid,
    toolExecutionDrawerAtom,
    toolIntegrationsSearchAtom,
    useToolCatalogIntegrations,
    useToolConnectionActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {ConnectDrawer, ToolExecutionDrawer} from "@agenta/entity-ui/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl} from "@agenta/shared/api"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {ScrollSentinel} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {InitialsAvatar} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    MagnifyingGlass,
    Play,
    Plugs,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"
import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {useToolsIntegrations, type CatalogIntegrationItem} from "./hooks/useToolsIntegrations"

const AUTH_SCHEME_LABELS: Record<string, string> = {
    oauth: "OAuth",
    api_key: "API Key",
}

/** Nouns for the page; a host that calls them something else passes its own. */
export interface GatewayToolsSectionCopy {
    run: string
    searchPlaceholder: string
    emptyTitle: string
    emptyBody: string
    noMatch: (term: string) => string
}

const DEFAULT_COPY: GatewayToolsSectionCopy = {
    run: "Run tool",
    searchPlaceholder: "Search tools",
    emptyTitle: "No tools connected yet",
    emptyBody: "Connect a tool to let your agents call it.",
    noMatch: (term) => `No tools match “${term}”`,
}

/** The same reading as ConnectionStatusBadge. */
const connectionStatus = (
    connection: ToolConnection,
): Pick<SettingsCatalogItem, "status" | "statusLabel"> => {
    if (!isConnectionActive(connection)) return {status: "attention", statusLabel: "Inactive"}
    if (!isConnectionValid(connection)) return {status: "attention", statusLabel: "Pending"}
    return {status: "connected", statusLabel: "Connected"}
}

const authLabel = (connection: ToolConnection): string | undefined => {
    const scheme = connection.data?.auth_scheme
    return typeof scheme === "string" ? (AUTH_SCHEME_LABELS[scheme] ?? scheme) : undefined
}

const IntegrationLogo = ({src, name}: {src?: string | null; name: string}) =>
    src ? <img src={src} alt="" aria-hidden /> : <InitialsAvatar size="small" name={name} />

/**
 * A connection's catalog entry: the first catalog page has the popular ones, the rest come from
 * their own (cached) detail lookup, so every connected row gets its real logo and name.
 */
const useCatalogEntry = (integrationKey: string, known?: CatalogIntegrationItem) => {
    const {integration} = useToolIntegrationDetail(known ? "" : integrationKey)
    return known ?? integration
}

const ConnectionLogo = ({
    integrationKey,
    known,
    name,
}: {
    integrationKey: string
    known?: CatalogIntegrationItem
    name: string
}) => {
    const entry = useCatalogEntry(integrationKey, known)
    return <IntegrationLogo src={entry?.logo} name={name} />
}

const ConnectionDescription = ({
    integrationKey,
    known,
    auth,
}: {
    integrationKey: string
    known?: CatalogIntegrationItem
    auth?: string
}) => {
    const entry = useCatalogEntry(integrationKey, known)
    return <>{[entry?.name ?? integrationKey, auth].filter(Boolean).join(" · ")}</>
}

/** The connect flow for an integration already connected, once its catalog entry resolves. */
const AnotherConnection = ({
    integrationKey,
    known,
    onClose,
    onSuccess,
}: {
    integrationKey: string
    known?: CatalogIntegrationItem
    onClose: () => void
    onSuccess: () => void
}) => {
    const entry = useCatalogEntry(integrationKey, known)
    if (!entry) return null
    return (
        <ConnectDrawer
            open
            integrationKey={entry.key}
            integrationName={entry.name}
            integrationLogo={entry.logo ?? undefined}
            integrationDescription={entry.description ?? undefined}
            authSchemes={entry.auth_schemes ?? []}
            onClose={onClose}
            onSuccess={onSuccess}
        />
    )
}

export interface GatewayToolsSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides connect, run and the Available catalog: the connect form is still antd-backed. */
    readOnly?: boolean
    /** Overrides the nouns; defaults to the "tool" wording oss/ee use. */
    copy?: Partial<GatewayToolsSectionCopy>
}

export default function GatewayToolsSection({
    confirm,
    readOnly,
    copy: copyOverrides,
}: GatewayToolsSectionProps) {
    const copy = useMemo<GatewayToolsSectionCopy>(
        () => ({...DEFAULT_COPY, ...copyOverrides}),
        [copyOverrides],
    )
    const {connections, isLoading, refetch} = useToolConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useToolConnectionActions()
    // The catalog's first page: the logos, and the Popular rows.
    const {integrations, isLoading: integrationsLoading} = useToolsIntegrations()
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)
    // One search for the page: it filters the connected rows here and the catalog on the server.
    const setServerSearch = useSetAtom(toolIntegrationsSearchAtom)
    const search = useDebouncedAtomSearch(
        useCallback((value: string) => setServerSearch(value.trim()), [setServerSearch]),
    )
    const searchTerm = search.value
    // The search atom is module-level; leaving the page must not leave the catalog filtered.
    useEffect(() => () => setServerSearch(""), [setServerSearch])
    // The whole catalog, a page at a time as the reader scrolls.
    const available = useToolCatalogIntegrations()
    const [connectTarget, setConnectTarget] = useState<CatalogIntegrationItem | null>(null)
    // A second connection to an integration already connected, e.g. another account.
    const [anotherKey, setAnotherKey] = useState<string | null>(null)

    const openExecution = useCallback(
        (record: ToolConnection) => {
            if (!record.id || !record.slug) return
            setExecutionDrawer({
                connectionId: record.id,
                connectionSlug: record.slug,
                integrationKey: record.integration_key,
            })
        },
        [setExecutionDrawer],
    )

    const onRefresh = useCallback(
        async (connection: ToolConnection) => {
            if (!connection.id) return
            const connectionId = connection.id
            try {
                const result = await handleRefresh(connectionId)

                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url

                if (typeof redirectUrl === "string" && redirectUrl) {
                    // OAuth re-auth: open popup and wait for completion
                    const popup = window.open(
                        redirectUrl,
                        "tools_oauth",
                        "width=600,height=700,popup=yes",
                    )

                    const cleanup = async () => {
                        window.focus()
                        // Poll the individual connection endpoint which checks
                        // Composio for status and updates is_valid in the DB.
                        try {
                            await fetchToolConnection(connectionId)
                        } catch {
                            /* best-effort */
                        }
                        invalidateConnections()
                        message.success("Connection refreshed")
                    }

                    const trustedOrigins = new Set<string>([window.location.origin])
                    for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                        if (!url) continue
                        try {
                            trustedOrigins.add(new URL(url).origin)
                        } catch {
                            // ignore invalid env URLs
                        }
                    }

                    const handler = (event: MessageEvent) => {
                        if (
                            event.data?.type === "tools:oauth:complete" &&
                            trustedOrigins.has(event.origin)
                        ) {
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }
                    window.addEventListener("message", handler)

                    // Fallback: detect popup closed
                    const pollTimer = setInterval(() => {
                        if (popup && popup.closed) {
                            clearInterval(pollTimer)
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }, 1000)
                } else {
                    message.success("Connection refreshed")
                }
            } catch {
                message.error("Failed to refresh connection")
            }
        },
        [handleRefresh, invalidateConnections],
    )

    const confirmDelete = useCallback(
        (connection: ToolConnection) => {
            confirm?.({
                title: "Delete Connection",
                message:
                    "Are you sure you want to delete this connection? This action is irreversible.",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleDelete(connection.id)
                        message.success("Connection deleted")
                    } catch {
                        message.error("Failed to delete connection")
                    }
                },
            })
        },
        [confirm, handleDelete],
    )

    const confirmRevoke = useCallback(
        (connection: ToolConnection) => {
            confirm?.({
                title: "Revoke Connection",
                message:
                    "This will mark the connection as invalid. You can refresh it later to reactivate.",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleRevoke(connection.id)
                        message.success("Connection revoked")
                    } catch {
                        message.error("Failed to revoke connection")
                    }
                },
            })
        },
        [confirm, handleRevoke],
    )

    const term = searchTerm.trim().toLowerCase()
    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const matches = (texts: (string | null | undefined)[]) =>
            !term || texts.some((text) => text?.toLowerCase().includes(term))
        const catalog = new Map(integrations.map((integration) => [integration.key, integration]))

        const connected = (connections ?? []).flatMap(
            (connection, index): SettingsCatalogItem[] => {
                if (!matches([connection.name, connection.slug, connection.integration_key])) {
                    return []
                }
                const integration = catalog.get(connection.integration_key ?? "")
                const name = connection.name || connection.slug || "—"
                return [
                    {
                        key:
                            connection.id ??
                            connection.slug ??
                            connection.integration_key ??
                            `tool-${index}`,
                        logo: (
                            <ConnectionLogo
                                integrationKey={connection.integration_key ?? ""}
                                known={integration}
                                name={name}
                            />
                        ),
                        name,
                        description: (
                            <ConnectionDescription
                                integrationKey={connection.integration_key ?? ""}
                                known={integration}
                                auth={authLabel(connection)}
                            />
                        ),
                        ...connectionStatus(connection),
                        onOpen: readOnly ? undefined : () => openExecution(connection),
                        menu: (
                            <SettingsRowMenu
                                items={[
                                    {
                                        key: "run",
                                        hidden: readOnly,
                                        label: copy.run,
                                        icon: <Play size={14} />,
                                        onClick: () => openExecution(connection),
                                    },
                                    {
                                        key: "refresh",
                                        hidden: readOnly,
                                        label: "Refresh",
                                        icon: <ArrowClockwise size={14} />,
                                        onClick: () => onRefresh(connection),
                                    },
                                    {
                                        key: "revoke",
                                        label: "Revoke",
                                        icon: <XCircle size={14} />,
                                        hidden: !confirm,
                                        onClick: () => confirmRevoke(connection),
                                    },
                                    {
                                        key: "another",
                                        hidden: readOnly,
                                        label: "Add another connection",
                                        icon: <Plus size={14} />,
                                        onClick: () =>
                                            setAnotherKey(connection.integration_key ?? null),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !confirm,
                                        onClick: () => confirmDelete(connection),
                                    },
                                ]}
                            />
                        ),
                    },
                ]
            },
        )
        if (readOnly) return [{key: "connected", label: "Connected", items: connected}]

        const connectedKeys = new Set((connections ?? []).map((c) => c.integration_key))
        // The server searches from three characters; below that, narrow what has loaded.
        const serverSearched = term.length >= 3
        const rows = available.integrations
            .filter(
                (integration) =>
                    !connectedKeys.has(integration.key) &&
                    (serverSearched || matches([integration.name, integration.description])),
            )
            .map(
                (integration): SettingsCatalogItem => ({
                    key: integration.key,
                    logo: <IntegrationLogo src={integration.logo} name={integration.name} />,
                    name: integration.name,
                    description: integration.description ?? undefined,
                    status: "available",
                    statusLabel: `Connect ${integration.name}`,
                    onOpen: () => setConnectTarget(integration),
                }),
            )
        const fetching = available.isLoading || available.isFetchingNextPage

        return [
            {key: "connected", label: "Connected", items: connected},
            {
                key: "available",
                label: "Available",
                items: rows,
                // Rows load a page at a time, so a count of what has loaded would mislead.
                count: null,
                pendingRows: fetching ? 4 : 0,
                // Only while more pages exist: a footer keeps an empty group on screen.
                footer: available.hasNextPage ? (
                    <ScrollSentinel
                        onVisible={available.requestMore}
                        hasMore
                        isFetching={fetching}
                    />
                ) : undefined,
            },
        ]
    }, [
        term,
        integrations,
        available.integrations,
        available.isLoading,
        available.isFetchingNextPage,
        available.hasNextPage,
        available.requestMore,
        connections,
        readOnly,
        copy,
        confirm,
        openExecution,
        onRefresh,
        confirmRevoke,
        confirmDelete,
    ])

    return (
        <>
            <section className="ph-no-capture">
                <SettingsCatalog
                    search={{
                        value: searchTerm,
                        onChange: search.onChange,
                        placeholder: copy.searchPlaceholder,
                    }}
                    groups={groups}
                    loading={isLoading || integrationsLoading}
                    empty={
                        term ? (
                            <SettingsEmpty
                                icon={<MagnifyingGlass size={18} />}
                                title={copy.noMatch(searchTerm.trim())}
                                action={
                                    <Button variant="outline" onClick={() => search.onChange("")}>
                                        Clear search
                                    </Button>
                                }
                            />
                        ) : (
                            <SettingsEmpty
                                icon={<Plugs size={18} />}
                                title={copy.emptyTitle}
                                description={copy.emptyBody}
                            />
                        )
                    }
                />
            </section>

            {readOnly || !anotherKey ? null : (
                <AnotherConnection
                    integrationKey={anotherKey}
                    known={integrations.find((integration) => integration.key === anotherKey)}
                    onClose={() => setAnotherKey(null)}
                    onSuccess={refetch}
                />
            )}
            {readOnly ? null : <ToolExecutionDrawer />}
            {readOnly || !connectTarget ? null : (
                <ConnectDrawer
                    open
                    integrationKey={connectTarget.key}
                    integrationName={connectTarget.name}
                    integrationLogo={connectTarget.logo ?? undefined}
                    integrationDescription={connectTarget.description ?? undefined}
                    authSchemes={connectTarget.auth_schemes ?? []}
                    onClose={() => setConnectTarget(null)}
                    onSuccess={refetch}
                />
            )}
        </>
    )
}
