import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    toolExecutionDrawerAtom,
    toolIntegrationsSearchAtom,
    useToolCatalogCategories,
    useToolConnectionActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {
    ConnectDrawer,
    FinishConnectionDialog,
    ToolExecutionDrawer,
    useRefreshToolConnection,
} from "@agenta/entity-ui/gatewayTool"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {connectionDisplayName} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, MagnifyingGlass, Play, Trash, XCircle} from "@phosphor-icons/react"
import {useAtom, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {ConfirmDestructive} from "../confirm"
import {findScrollRoot} from "../shared/scrollRoot"
import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {CategoryChips} from "./CategoryChips"
import {categoryLabel} from "./categoryLabel"
import {useToolsIntegrations, type CatalogIntegrationItem} from "./hooks/useToolsIntegrations"
import {IntegrationCatalog, IntegrationLogo} from "./IntegrationCatalog"

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

/** A connection's catalog entry: from the first page when there, else its cached detail. */
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

/** The app's display name ("Google Maps"), falling back to the connection's own name. */
const AppName = ({
    connection,
    known,
}: {
    connection: ToolConnection
    known?: CatalogIntegrationItem
}) => {
    const entry = useCatalogEntry(connection.integration_key ?? "", known)
    return <>{entry?.name ?? connection.name ?? connection.slug}</>
}

/** The connection's name; one stored only as its slug reads as the app ("YouTube (main)"). */
const ConnectionName = ({
    connection,
    known,
}: {
    connection: ToolConnection
    known?: CatalogIntegrationItem
}) => {
    const entry = useCatalogEntry(connection.integration_key ?? "", known)
    return <>{connectionDisplayName(connection, entry?.name) || "—"}</>
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

/** Per viewer: a long Connected list folds away and stays folded. */
const connectedCollapsedAtom = atomWithStorage(
    "agenta:settings:integrations-connected-collapsed",
    false,
)

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
    const {handleDelete, handleRevoke} = useToolConnectionActions()
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
    const [connectTarget, setConnectTarget] = useState<CatalogIntegrationItem | null>(null)
    // A pending connection opens to finishing its sign-in, not to its tools.
    const [finishing, setFinishing] = useState<{
        connection: ToolConnection
        name: string
        integration?: CatalogIntegrationItem
    } | null>(null)
    const [connectedCollapsed, setConnectedCollapsed] = useAtom(connectedCollapsedAtom)
    // The category chip; `null` is All. A category shows only its own list.
    const [category, setCategory] = useState<string | null>(null)
    const sectionRef = useRef<HTMLElement>(null)
    const {categories} = useToolCatalogCategories()
    const categoryName = categories.find((entry) => entry.id === category)?.name
    const selectCategory = useCallback((next: string | null) => {
        setCategory(next)
        findScrollRoot(sectionRef.current)?.scrollTo({top: 0})
    }, [])

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

    const onRefresh = useRefreshToolConnection()

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
        if (category) return []
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
                        name: <ConnectionName connection={connection} known={integration} />,
                        description: (
                            <ConnectionDescription
                                integrationKey={connection.integration_key ?? ""}
                                known={integration}
                                auth={authLabel(connection)}
                            />
                        ),
                        ...connectionStatus(connection),
                        onOpen: readOnly
                            ? undefined
                            : isConnectionActive(connection) && !isConnectionValid(connection)
                              ? () => setFinishing({connection, name, integration})
                              : () => openExecution(connection),
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
        return [
            {
                key: "connected",
                label: "Connected",
                items: connected,
                // A search always shows what it matched.
                collapsed: !term && connectedCollapsed,
                onToggle: term ? undefined : () => setConnectedCollapsed((value) => !value),
            },
        ]
    }, [
        category,
        term,
        connectedCollapsed,
        setConnectedCollapsed,
        integrations,
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
            <section ref={sectionRef} className="ph-no-capture">
                <SettingsCatalog
                    search={{
                        value: searchTerm,
                        onChange: search.onChange,
                        placeholder: categoryName
                            ? `Search ${categoryLabel(categoryName)}`
                            : copy.searchPlaceholder,
                    }}
                    toolbar={
                        readOnly ? undefined : (
                            <CategoryChips selected={category} onSelect={selectCategory} />
                        )
                    }
                    groups={groups}
                    loading={isLoading || integrationsLoading}
                    after={
                        readOnly ? undefined : (
                            <IntegrationCatalog
                                term={term}
                                category={category}
                                onSelectCategory={selectCategory}
                                connectedMatches={groups[0]?.items.length ?? 0}
                                onConnect={setConnectTarget}
                                onClearSearch={() => search.onChange("")}
                                noMatch={copy.noMatch}
                            />
                        )
                    }
                    empty={
                        term ? (
                            <SettingsEmpty
                                plain
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
                                icon={getSettingsSidebarIcon("tools")}
                                title={copy.emptyTitle}
                                description={copy.emptyBody}
                            />
                        )
                    }
                />
            </section>

            {readOnly ? null : <ToolExecutionDrawer />}
            {finishing ? (
                <FinishConnectionDialog
                    open
                    name={
                        <AppName connection={finishing.connection} known={finishing.integration} />
                    }
                    logo={
                        <ConnectionLogo
                            integrationKey={finishing.connection.integration_key ?? ""}
                            known={finishing.integration}
                            name={finishing.name}
                        />
                    }
                    onAuthorize={() => onRefresh(finishing.connection)}
                    onDelete={confirm ? () => confirmDelete(finishing.connection) : undefined}
                    onClose={() => setFinishing(null)}
                />
            ) : null}
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
