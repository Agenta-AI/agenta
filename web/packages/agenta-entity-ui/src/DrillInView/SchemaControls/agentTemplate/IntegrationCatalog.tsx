/**
 * IntegrationCatalog
 *
 * Add WHOLE integrations to an agent. Adding one adds every tool the integration has; what the
 * author configures afterwards, from the integration's row, is the permission policy. There is no
 * per-action catalog here any more.
 *
 * Three ways in, all landing the same entry: quick-add from a connection the project already has,
 * pick a connection when an integration has several, and Connect, which the host opens (the
 * connect view) and which stores a project connection; the catalog then adds the new connection.
 *
 * A new integration lands on "Allow all". Choosing another connection for an
 * integration that is already configured REPLACES its entry, keeping the policy already set.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    toolIntegrationDetailQueryFamily,
    toolIntegrationsSearchAtom,
    useToolCatalogIntegrations,
    useToolConnectionActions,
    usePersonalToolConnections,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolCatalogIntegration,
    type ToolCatalogIntegrationDetails,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {connectionDisplayName} from "@agenta/shared/utils"
import {HeightCollapse, ScrollSentinel} from "@agenta/ui"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {
    Button,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    RadioGroup,
    RadioGroupItem,
    SearchInput,
} from "@agenta/ui/ui"
import {Check, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {CreatedConnection} from "../../../gatewayTool/components/ConnectForm"
import {FinishConnectionDialog} from "../../../gatewayTool/components/FinishConnectionDialog"
import {useRefreshToolConnection} from "../../../gatewayTool/hooks/useRefreshToolConnection"
import {ProviderLogo, SubSectionHeader} from "../sectionGroups"
import type {GatewayConnectionTarget, IntegrationRow} from "../toolUtils"

import {CatalogListRow} from "./CatalogListRow"
import {CatalogRowSkeleton} from "./CatalogRowSkeleton"
import {CategorySelect} from "./CategorySelect"
import {ConnectionActionConfirm, type ConnectionAction} from "./ConnectionActionConfirm"
import {ConnectionRowMenu} from "./ConnectionRowMenu"
import {catalogSections, type CategorySelection} from "./integrationCatalogFilters"

const tNow = createT(integrationDrawerCatalog)

type CatalogIntegration = ToolCatalogIntegration | ToolCatalogIntegrationDetails

/** A connection a connect form made, waiting to be valid before it is added. */
interface PendingConnect extends CreatedConnection {
    integrationKey: string
}

/** Whether "Connected" is folded away; remembered, as Settings remembers its own. */
const connectedCollapsedAtom = atomWithStorage(
    "agenta:agent-integrations:connected-collapsed",
    false,
)

/** What the catalog needs to add apps to an agent. Absent, it only browses and connects. */
export interface IntegrationCatalogAdding {
    /** The integrations the agent already holds — the added state and the current connection. */
    integrationRows: IntegrationRow[]
    /** Add an integration, or point a configured one at another connection. One write, one entry. */
    onAddIntegration: (target: GatewayConnectionTarget, connectionSlug: string) => void
    /** Add an integration that uses each person's own account. */
    onAddPersonalIntegration: (target: GatewayConnectionTarget) => void
}

export interface IntegrationCatalogProps {
    /** Adds apps to an agent; absent in a place with no agent (chat, playground, prompts). */
    adding?: IntegrationCatalogAdding
    /**
     * Open the connect form of an app. The form calls `onCreated` with the connection it made,
     * and the catalog adds that one once it is valid. A cancelled form calls nothing.
     */
    onConnect: (integrationKey: string, onCreated: (created: CreatedConnection) => void) => void
}

interface ConnectedGroup {
    integrationKey: string
    provider: string
    connections: ToolConnection[]
}

/** The identity of an integration row is the PAIR; the integration alone merges two providers. */
const groupKey = (provider: string, integration: string): string => `${provider}:${integration}`

/** The project's connections, grouped by the provider and integration they belong to. */
function groupConnections(connections: ToolConnection[]): ConnectedGroup[] {
    const groups = new Map<string, ConnectedGroup>()
    for (const connection of connections) {
        if (!connection.integration_key || !connection.slug) continue
        const provider = connection.provider_key ?? "composio"
        const key = groupKey(provider, connection.integration_key)
        let group = groups.get(key)
        if (!group) {
            group = {
                integrationKey: connection.integration_key,
                provider,
                connections: [],
            }
            groups.set(key, group)
        }
        group.connections.push(connection)
    }
    return [...groups.values()]
}

/** Connections are shown by NAME; one named only by its slug reads as the app (see helper). */
const connectionLabel = (connection: ToolConnection | undefined, appName?: string): string =>
    connectionDisplayName(connection, appName)

const authLabel = (connection: ToolConnection | undefined): string | undefined => {
    const scheme = connection?.data?.auth_scheme
    if (typeof scheme !== "string") return undefined
    if (scheme === "oauth") return "OAuth"
    if (scheme === "api_key") return tNow("entityUi.integrationDrawer.apiKeyScheme")
    return scheme
}

type Attention = "inactive" | "pending"

/** Settings' reading of a connection that needs attention; null when it works. */
const attentionOf = (connection: ToolConnection | undefined): Attention | null => {
    if (!connection) return null
    if (!isConnectionActive(connection)) return "inactive"
    if (!isConnectionValid(connection)) return "pending"
    return null
}

/** The app logo in Settings' tile: a bordered 32px square. */
function LogoTile({logo}: {logo: string | null}) {
    return (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs [&_img]:size-[18px] [&_img]:object-contain">
            <ProviderLogo logo={logo} size={18} />
        </span>
    )
}

/** What a row hands up for the drawer to run: a finish sign-in, or a confirmed verb. */
export interface ConnectionRowHandlers {
    onFinish: (connection: ToolConnection, name: string, logo: string | null) => void
    onRefresh: (connection: ToolConnection) => void
    onConfirm: (action: ConnectionAction, connection: ToolConnection, label: string) => void
}

/** A row in "Connected in your workspace": quick-add, or open the connection chooser. */
function ConnectedRow({
    group,
    row,
    onAdd,
    handlers,
}: {
    group: ConnectedGroup
    /** The agent's row for this integration, in EITHER format, or undefined when it holds none. */
    row: IntegrationRow | undefined
    /** Absent where nothing is added to an agent: the row only lists the connection. */
    onAdd?: (slug: string) => void
    handlers: ConnectionRowHandlers
}) {
    const t = useT(integrationDrawerCatalog)
    const {integration} = useToolIntegrationDetail(group.integrationKey)
    const name = integration?.name || group.integrationKey
    const multiple = group.connections.length > 1
    const [choosing, setChoosing] = useState(false)
    const currentSlug = row?.entry?.connection
    const [selected, setSelected] = useState(() => currentSlug ?? group.connections[0]?.slug ?? "")
    const selectedName = connectionLabel(
        group.connections.find((connection) => connection.slug === selected) ??
            group.connections[0],
        integration?.name,
    )

    // Adding again would give one integration two model-facing surfaces, so one the agent already
    // holds offers no Add. Choosing another connection edits the entry, which an integration still
    // on the legacy per-action format does not have.
    const added = Boolean(row)
    const swappable = Boolean(row?.entry)
    const single = group.connections[0]

    const logo = integration?.logo ?? null
    // One connection reads as Settings reads it: the connection's own name, then "App · Auth".
    const attention = multiple ? null : attentionOf(single)
    const title = multiple ? name : connectionLabel(single, integration?.name)

    const subtitle = choosing
        ? t("entityUi.integrationDrawer.chooseConnection")
        : added && !swappable
          ? t("entityUi.integrationDrawer.alreadyAddedOldFormat")
          : multiple
            ? t("entityUi.integrationDrawer.connectionCount", {count: group.connections.length})
            : // What the app does says more than repeating its name; the old line is the fallback.
              integration?.description?.trim() ||
              [name, authLabel(single)].filter(Boolean).join(" · ")

    // An added integration offers Change only when it has an entry to edit; adding a second
    // surface to one still on the legacy format is never the intent.
    const chooserButton = Boolean(onAdd) && multiple && (!added || swappable)

    // Adding is the row's own click; only switching connections needs a visible button.
    const rowAction =
        chooserButton && (choosing || added) ? (
            <Button variant="ghost" size="sm" onClick={() => setChoosing((v) => !v)}>
                {choosing
                    ? t("entityUi.integrationDrawer.cancel")
                    : t("entityUi.integrationDrawer.change")}
            </Button>
        ) : null

    return (
        <CatalogListRow
            highlighted={choosing}
            actionLabel={t("entityUi.integrationDrawer.addName", {name})}
            onClick={
                choosing
                    ? undefined
                    : // As in Settings: a sign-in that never finished opens to finishing it.
                      attention === "pending"
                      ? () => handlers.onFinish(single, name, logo)
                      : chooserButton
                        ? () => setChoosing(true)
                        : onAdd && !added && single.slug
                          ? () => onAdd(single.slug ?? "")
                          : undefined
            }
            leading={<LogoTile logo={logo} />}
            title={title}
            titleSuffix={
                added && !choosing ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-colorSuccess">
                        <Check size={11} weight="bold" />
                        {t("entityUi.integrationDrawer.added")}
                    </span>
                ) : attention ? (
                    // Beside the name and never truncated, so the problem always shows.
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-colorWarning">
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        {attention === "inactive"
                            ? t("entityUi.integrationDrawer.inactive")
                            : t("entityUi.integrationDrawer.pending")}
                    </span>
                ) : null
            }
            action={
                <span className="flex items-center gap-0.5">
                    {rowAction}
                    {/* Per-connection verbs need one connection to act on. */}
                    {multiple ? null : (
                        <ConnectionRowMenu
                            onRefresh={() => handlers.onRefresh(single)}
                            onRevoke={() => handlers.onConfirm("revoke", single, title)}
                            onDelete={() => handlers.onConfirm("delete", single, title)}
                        />
                    )}
                </span>
            }
            expansion={
                choosing ? (
                    <div className="ml-[42px] mt-2 flex flex-col gap-1">
                        <RadioGroup value={selected} onValueChange={setSelected}>
                            {group.connections.map((connection) => (
                                <label
                                    key={connection.slug}
                                    className={`flex cursor-pointer items-center gap-2 rounded border border-solid px-2.5 py-1.5 text-xs ${
                                        selected === connection.slug
                                            ? "border-[var(--ag-colorText)]"
                                            : "border-[var(--ag-colorBorderSecondary)]"
                                    }`}
                                >
                                    <RadioGroupItem value={connection.slug ?? ""} />
                                    <span className="flex-1 truncate">
                                        {connectionLabel(connection, integration?.name)}
                                    </span>
                                    {isConnectionValid(connection) ? null : (
                                        <span className="shrink-0 text-[var(--ag-colorWarningText)]">
                                            {t("entityUi.integrationDrawer.needsReconnect")}
                                        </span>
                                    )}
                                </label>
                            ))}
                        </RadioGroup>
                        <div className="flex justify-end">
                            <Button
                                variant="default"
                                size="sm"
                                disabled={!selected || selected === currentSlug}
                                onClick={() => {
                                    onAdd?.(selected)
                                    setChoosing(false)
                                }}
                            >
                                {added
                                    ? t("entityUi.integrationDrawer.useName", {name: selectedName})
                                    : t("entityUi.integrationDrawer.addWithName", {
                                          name: selectedName,
                                      })}
                            </Button>
                        </div>
                    </div>
                ) : null
            }
        >
            <span className="truncate text-xs text-[var(--ag-colorTextTertiary)]" title={subtitle}>
                {subtitle}
            </span>
        </CatalogListRow>
    )
}

/** A row in "All apps": an integration the project has no connection for yet. */
function CatalogRow({
    integration,
    onConnect,
}: {
    integration: CatalogIntegration
    onConnect: () => void
}) {
    const t = useT(integrationDrawerCatalog)
    return (
        <CatalogListRow
            onClick={onConnect}
            leading={<LogoTile logo={integration.logo ?? null} />}
            title={integration.name}
            actionLabel={t("entityUi.integrationDrawer.connectName", {name: integration.name})}
            action={
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("entityUi.integrationDrawer.connectName", {
                        name: integration.name,
                    })}
                    title={t("entityUi.integrationDrawer.connect")}
                    onClick={onConnect}
                >
                    <Plus size={16} />
                </Button>
            }
        >
            {integration.description ? (
                // One line; the full text stays available on hover.
                <span
                    className="truncate text-xs text-[var(--ag-colorTextTertiary)]"
                    title={integration.description}
                >
                    {integration.description}
                </span>
            ) : null}
        </CatalogListRow>
    )
}

/** The catalog: the project's connected apps, then all apps. Mounted only while it shows. */
export function IntegrationCatalog({adding, onConnect}: IntegrationCatalogProps) {
    const t = useT(integrationDrawerCatalog)
    // The catalog's own box: its dialogs and the category list open inside it, so they stay in
    // a drawer host and scroll under the drawer's lock.
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    const [query, setQuery] = useState("")
    const [category, setCategoryState] = useState<CategorySelection | null>(null)
    const [connectedCollapsed, setConnectedCollapsed] = useAtom(connectedCollapsedAtom)
    // Fades the list's top and bottom edges while there is more to scroll that way.
    const listRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(listRef)
    // A search always shows what it matched.
    const searching = query.trim().length > 0
    // The connection a connect form made, until it is valid and added.
    const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null)
    const {connections: personalConnections} = usePersonalToolConnections()
    // The rows' Settings verbs: finish a pending sign-in, or confirm a revoke or delete.
    const [finishing, setFinishing] = useState<{
        connection: ToolConnection
        name: string
        logo: string | null
    } | null>(null)
    const [confirming, setConfirming] = useState<{
        action: ConnectionAction
        connection: ToolConnection
        label: string
    } | null>(null)
    const refreshConnection = useRefreshToolConnection()
    const {handleDelete, handleRevoke} = useToolConnectionActions()
    const rowHandlers = useMemo<ConnectionRowHandlers>(
        () => ({
            onFinish: (connection, name, logo) => setFinishing({connection, name, logo}),
            onRefresh: (connection) => void refreshConnection(connection),
            onConfirm: (action, connection, label) => setConfirming({action, connection, label}),
        }),
        [refreshConnection],
    )

    const setSearch = useSetAtom(toolIntegrationsSearchAtom)
    const {
        integrations,
        total,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        requestMore,
        setCategory,
    } = useToolCatalogIntegrations()
    const {connections} = useToolConnectionsQuery()

    // The hook ignores a query under three characters server-side; the connected list filters on
    // the raw query instead, so a two-letter search still narrows what the author already has.
    useEffect(() => {
        const timer = setTimeout(() => setSearch(query.trim()), 250)
        return () => clearTimeout(timer)
    }, [query, setSearch])
    // Both filters live in module atoms shared with the other catalog surfaces, and this drawer's
    // own controls start empty. Clear them on the way out so the next open matches what it shows.
    useEffect(
        () => () => {
            setSearch("")
            setCategory?.(null)
        },
        [setSearch, setCategory],
    )

    const allConnectedGroups = useMemo(() => groupConnections(connections), [connections])

    // Read through the SAME query atoms each row uses, so this shares their cache.
    const connectedKeys = useMemo(
        () => allConnectedGroups.map((group) => group.integrationKey).sort(),
        [allConnectedGroups],
    )
    const connectedDetailsAtom = useMemo(
        () =>
            atom((get) =>
                connectedKeys.map((key) => ({
                    key,
                    integration: get(toolIntegrationDetailQueryFamily(key)).data?.integration,
                })),
            ),
        [connectedKeys],
    )
    const connectedDetails = useAtomValue(connectedDetailsAtom)
    const {categoriesByIntegration, namesByIntegration} = useMemo(() => {
        const categoriesMap = new Map<string, readonly string[]>()
        const namesMap = new Map<string, string>()
        for (const {key, integration} of connectedDetails) {
            if (!integration) continue
            categoriesMap.set(key, integration.categories ?? [])
            if (integration.name) namesMap.set(key, integration.name)
        }
        return {categoriesByIntegration: categoriesMap, namesByIntegration: namesMap}
    }, [connectedDetails])

    // Filtered here, not inside each row, so the section count matches the rows it heads.
    const {connected: connectedGroups, connectable: catalogRows} = useMemo(
        () =>
            catalogSections({
                integrations,
                groups: allConnectedGroups,
                query,
                category,
                categoriesByIntegration,
                namesByIntegration,
            }),
        [
            integrations,
            allConnectedGroups,
            query,
            category,
            categoriesByIntegration,
            namesByIntegration,
        ],
    )
    const rowsByIntegration = useMemo(
        () =>
            new Map(
                (adding?.integrationRows ?? []).map((row) => [
                    groupKey(row.provider, row.integration),
                    row,
                ]),
            ),
        [adding?.integrationRows],
    )

    // The connect form stores the connection in the project (or the person's own) and names it.
    // Adding it to the agent is this catalog's own write. A closed sign-in window is not a
    // sign-in, so the add waits until the connection is valid; the row keeps its reconnect hint
    // until then.
    useEffect(() => {
        if (!pendingConnect || !adding) return
        const {integrationKey, slug, owner} = pendingConnect
        const list = owner === "user" ? (personalConnections ?? []) : connections
        const made = list.find((connection) => connection.slug === slug)
        if (!made || !isConnectionValid(made)) return
        if (owner === "user") {
            adding.onAddPersonalIntegration({provider: "composio", integration: integrationKey})
        } else {
            adding.onAddIntegration(
                {provider: made.provider_key ?? "composio", integration: integrationKey},
                slug,
            )
        }
        setPendingConnect(null)
    }, [pendingConnect, connections, personalConnections, adding])

    const startConnect = useCallback(
        (integrationKey: string) =>
            onConnect(integrationKey, (created) => {
                // Only a catalog that adds to an agent waits for the new connection.
                if (adding) setPendingConnect({integrationKey, ...created})
            }),
        [onConnect, adding],
    )

    const catalogLoading = isLoading && integrations.length === 0
    const nothingFound = !catalogLoading && connectedGroups.length === 0 && catalogRows.length === 0

    return (
        <div ref={setContainer} className="relative flex min-h-0 flex-1">
            {/* One column: the category filter sits beside the search, so apps get the width. */}
            {/* min-w-0: without it the one-line descriptions stretch the column past the drawer. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* Fixed above the scroll. pt-1 keeps the focus ring inside the body's clip. */}
                <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-1">
                    <SearchInput
                        className="min-w-0 flex-1"
                        placeholder={t("entityUi.integrationDrawer.searchApps")}
                        value={query}
                        onValueChange={setQuery}
                    />
                    <CategorySelect
                        value={category}
                        container={container}
                        onChange={(next) => {
                            setCategoryState(next)
                            setCategory?.(next?.id ?? null)
                        }}
                    />
                </div>

                <div
                    ref={listRef}
                    className="ag-scroll-fade flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4"
                >
                    {connectedGroups.length > 0 ? (
                        // No gap: the spacing rides inside the collapse, so a folded list leaves none.
                        <div className="flex flex-col">
                            <SubSectionHeader
                                label={t("entityUi.integrationDrawer.connected")}
                                count={connectedGroups.length}
                                collapsed={!searching && connectedCollapsed}
                                onToggle={
                                    searching
                                        ? undefined
                                        : () => setConnectedCollapsed((value) => !value)
                                }
                            />
                            {/* -mx/px: the rows' hover fill and focus ring bleed 8px past the
                            column, and the collapse clips its overflow. */}
                            <HeightCollapse
                                open={searching || !connectedCollapsed}
                                fade
                                className="-mx-2"
                                contentClassName="flex flex-col px-2 pt-2"
                            >
                                {connectedGroups.map((group) => (
                                    <ConnectedRow
                                        key={groupKey(group.provider, group.integrationKey)}
                                        group={group}
                                        row={rowsByIntegration.get(
                                            groupKey(group.provider, group.integrationKey),
                                        )}
                                        onAdd={
                                            adding
                                                ? (slug) =>
                                                      slug &&
                                                      adding.onAddIntegration(
                                                          {
                                                              provider: group.provider,
                                                              integration: group.integrationKey,
                                                          },
                                                          slug,
                                                      )
                                                : undefined
                                        }
                                        handlers={rowHandlers}
                                    />
                                ))}
                            </HeightCollapse>
                        </div>
                    ) : null}

                    {nothingFound ? (
                        <Empty className="py-10">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <MagnifyingGlass />
                                </EmptyMedia>
                                <EmptyTitle>
                                    {query.trim()
                                        ? t("entityUi.integrationDrawer.noAppsMatch", {
                                              query: query.trim(),
                                          })
                                        : t("entityUi.integrationDrawer.noAppsHere")}
                                </EmptyTitle>
                                <EmptyDescription>
                                    {category
                                        ? t("entityUi.integrationDrawer.tryAnotherNameOrCategory")
                                        : t("entityUi.integrationDrawer.tryAnotherName")}
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    ) : null}

                    {/* Hidden when empty: the Connected matches, or the empty state, say it all. */}
                    {catalogLoading || catalogRows.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <SubSectionHeader
                                label={t("entityUi.integrationDrawer.allApps")}
                                count={catalogLoading ? undefined : (total ?? catalogRows.length)}
                            />
                            {catalogLoading ? (
                                <CatalogRowSkeleton />
                            ) : (
                                <div className="flex flex-col">
                                    {catalogRows.map((integration) => (
                                        <CatalogRow
                                            key={integration.key}
                                            integration={integration}
                                            onConnect={() => startConnect(integration.key)}
                                        />
                                    ))}
                                </div>
                            )}
                            <ScrollSentinel
                                onVisible={requestMore}
                                hasMore={hasNextPage}
                                isFetching={isFetchingNextPage}
                            />
                            {isFetchingNextPage ? <CatalogRowSkeleton count={2} /> : null}
                        </div>
                    ) : null}
                </div>
            </div>

            {finishing ? (
                <FinishConnectionDialog
                    open
                    container={container}
                    name={finishing.name}
                    logo={<ProviderLogo logo={finishing.logo} size={18} />}
                    onAuthorize={() => refreshConnection(finishing.connection)}
                    onDelete={() =>
                        setConfirming({
                            action: "delete",
                            connection: finishing.connection,
                            label: connectionLabel(finishing.connection, finishing.name),
                        })
                    }
                    onClose={() => setFinishing(null)}
                />
            ) : null}
            {confirming ? (
                <ConnectionActionConfirm
                    action={confirming.action}
                    name={confirming.label}
                    container={container}
                    onConfirm={async () => {
                        const id = confirming.connection.id
                        if (!id) return
                        if (confirming.action === "delete") await handleDelete(id)
                        else await handleRevoke(id)
                    }}
                    onClose={() => setConfirming(null)}
                />
            ) : null}
        </div>
    )
}
