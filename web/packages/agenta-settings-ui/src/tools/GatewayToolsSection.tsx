import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    invalidateToolConnections,
    isConnectionActive,
    isConnectionValid,
    isConnectionDefault,
    makeDefaultToolConnection,
    toolExecutionDrawerAtom,
    toolIntegrationsSearchAtom,
    useToolCatalogCategories,
    useToolConnectionActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    usePersonalToolConnections,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
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
import {ArrowClockwise, MagnifyingGlass, Play, Star, Trash, XCircle} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {ConfirmDestructive} from "../confirm"
import {addAccountOwners, showsYours} from "../shared/accountOwners"
import {LoadFailed} from "../shared/LoadFailed"
import {findScrollRoot} from "../shared/scrollRoot"
import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {YoursEmpty} from "../shared/YoursEmpty"

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
    isDefault,
}: {
    integrationKey: string
    known?: CatalogIntegrationItem
    auth?: string
    /** The person's default for this app: "Gmail · OAuth · Default". */
    isDefault?: boolean
}) => {
    const entry = useCatalogEntry(integrationKey, known)
    return (
        <>
            {[entry?.name ?? integrationKey, auth, isDefault ? "Default" : null]
                .filter(Boolean)
                .join(" · ")}
        </>
    )
}

/** Per viewer: a long Connected list folds away and stays folded. */
const connectedCollapsedAtom = atomWithStorage(
    "agenta:settings:integrations-connected-collapsed",
    false,
)

/** Per viewer, like Connected: the person's own accounts fold away and stay folded. */
const yoursCollapsedAtom = atomWithStorage("agenta:settings:integrations-yours-collapsed", false)

export interface GatewayToolsSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides connect, run and the Available catalog: the connect form is still antd-backed. */
    readOnly?: boolean
    /** Overrides the nouns; defaults to the "tool" wording oss/ee use. */
    copy?: Partial<GatewayToolsSectionCopy>
    /**
     * The project group's heading: the project switch. Given, the group is the project's and
     * does not fold; absent, it stays today's "Connected".
     */
    projectSwitch?: ReactNode
    /** The current project's name, for "Everyone in {project}" in the connect dialog. */
    projectName?: string
    /** How many projects the person has in the organization, for the empty "Yours" note. */
    projectCount?: number
    /**
     * Whether the person may add the project's accounts (`edit_tools`). Without it, and with
     * personal accounts on, the connect dialog adds the person's own account without asking.
     */
    canEdit?: boolean
}

export default function GatewayToolsSection({
    confirm,
    readOnly,
    copy: copyOverrides,
    projectSwitch,
    projectName,
    projectCount,
    canEdit = true,
}: GatewayToolsSectionProps) {
    const copy = useMemo<GatewayToolsSectionCopy>(
        () => ({...DEFAULT_COPY, ...copyOverrides}),
        [copyOverrides],
    )
    const {connections, isLoading, refetch} = useToolConnectionsQuery()
    const access = useAtomValue(personalAccountsAccessAtom)
    const {
        connections: personalConnections,
        error: personalError,
        refetch: refetchPersonal,
    } = usePersonalToolConnections()
    const yours = showsYours(access) && (personalConnections !== null || !!personalError)
    // The switch alone decides the owners, so a pending list read never defaults to the project.
    const connectOwners = addAccountOwners(access, canEdit)
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
    const [yoursCollapsed, setYoursCollapsed] = useAtom(yoursCollapsedAtom)
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

    // A person's default is what an agent that uses each person's own account picks for them.
    const makeDefault = useCallback(async (connection: ToolConnection) => {
        if (!connection.id) return
        try {
            await makeDefaultToolConnection(connection.id)
            invalidateToolConnections()
        } catch {
            message.error("Could not make it your default. Try again.")
        }
    }, [])

    const term = searchTerm.trim().toLowerCase()
    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        if (category) return []
        const matches = (texts: (string | null | undefined)[]) =>
            !term || texts.some((text) => text?.toLowerCase().includes(term))
        const catalog = new Map(integrations.map((integration) => [integration.key, integration]))

        /**
         * One row per connection. A person's own row keeps the verbs its by-id routes allow
         * (refresh, revoke, delete), adds "Make default", and has no "Run": a run goes through
         * the project's connection.
         */
        const toItems = (rows: ToolConnection[], personal: boolean) =>
            rows.flatMap((connection, index): SettingsCatalogItem[] => {
                if (!matches([connection.name, connection.slug, connection.integration_key])) {
                    return []
                }
                const integration = catalog.get(connection.integration_key ?? "")
                const name = connection.name || connection.slug || "—"
                const pending = isConnectionActive(connection) && !isConnectionValid(connection)
                const isDefault = personal && isConnectionDefault(connection)
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
                                isDefault={isDefault}
                            />
                        ),
                        ...connectionStatus(connection),
                        onOpen: readOnly
                            ? undefined
                            : pending
                              ? () => setFinishing({connection, name, integration})
                              : personal
                                ? undefined
                                : () => openExecution(connection),
                        menu: (
                            <SettingsRowMenu
                                items={[
                                    {
                                        key: "run",
                                        hidden: readOnly || personal,
                                        label: copy.run,
                                        icon: <Play size={14} />,
                                        onClick: () => openExecution(connection),
                                    },
                                    {
                                        key: "make-default",
                                        hidden:
                                            !personal ||
                                            isDefault ||
                                            !isConnectionActive(connection) ||
                                            !isConnectionValid(connection),
                                        label: "Make default",
                                        icon: <Star size={14} />,
                                        onClick: () => void makeDefault(connection),
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
            })

        const yoursItems = yours ? toItems(personalConnections ?? [], true) : []
        const projectGroup: SettingsCatalogGroup = {
            key: "connected",
            label: projectSwitch ?? "Connected",
            items: toItems(connections ?? [], false),
            // Under the project switch the group never folds and stays when empty, except in a search.
            ...(projectSwitch
                ? {keepWhenEmpty: !term}
                : {
                      // A search always shows what it matched.
                      collapsed: !term && connectedCollapsed,
                      onToggle: term ? undefined : () => setConnectedCollapsed((value) => !value),
                  }),
        }
        if (!yours) return [projectGroup]
        return [
            {
                key: "yours",
                label: "Yours",
                items: yoursItems,
                collapsed: !term && yoursCollapsed,
                onToggle: term ? undefined : () => setYoursCollapsed((value) => !value),
                // Empty, "Yours" says what it is for; a search with no match says nothing here.
                footer: personalError ? (
                    <LoadFailed
                        message="Couldn't load your connections."
                        onRetry={() => void refetchPersonal()}
                    />
                ) : !term && yoursItems.length === 0 ? (
                    <YoursEmpty projectCount={projectCount} />
                ) : undefined,
            },
            projectGroup,
        ]
    }, [
        category,
        term,
        connectedCollapsed,
        setConnectedCollapsed,
        yoursCollapsed,
        setYoursCollapsed,
        yours,
        personalConnections,
        personalError,
        refetchPersonal,
        projectSwitch,
        projectCount,
        makeDefault,
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
                                connectedMatches={groups.reduce(
                                    (total, group) => total + group.items.length,
                                    0,
                                )}
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
                    onSuccess={() => void refetch()}
                    owners={connectOwners}
                    projectName={projectName}
                />
            )}
        </>
    )
}
