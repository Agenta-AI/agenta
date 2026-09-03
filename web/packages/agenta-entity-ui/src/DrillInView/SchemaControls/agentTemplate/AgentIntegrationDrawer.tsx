/**
 * AgentIntegrationDrawer
 *
 * Add WHOLE integrations to an agent. Adding one adds every tool the integration has; what the
 * author configures afterwards, from the integration's row, is the permission policy. There is no
 * per-action catalog here any more.
 *
 * Three ways in, all landing the same entry: quick-add from a connection the project already has,
 * pick a connection when an integration has several, and Connect, which runs the existing
 * {@link ConnectDrawer} auth flow and then adds the integration.
 *
 * A new integration lands on "Allow all". Choosing another connection for an
 * integration that is already configured REPLACES its entry, keeping the policy already set.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    isConnectionValid,
    toolIntegrationDetailQueryFamily,
    toolIntegrationsSearchAtom,
    useToolCatalogCategories,
    useToolCatalogIntegrations,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolCatalogIntegration,
    type ToolCatalogIntegrationDetails,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {connectionDisplayName} from "@agenta/shared/utils"
import {ScrollSentinel} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, RadioGroup, RadioGroupItem, SearchInput, Spinner} from "@agenta/ui/ui"
import {Check, Plugs} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"

import ConnectDrawer from "../../../gatewayTool/drawers/ConnectDrawer"
import {ProviderLogo, SubSectionHeader} from "../sectionGroups"
import type {GatewayConnectionTarget, IntegrationRow} from "../toolUtils"

import {CatalogListRow} from "./CatalogListRow"
import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"
import {ExpandableDescription} from "./ExpandableDescription"
import {catalogSections, type CategorySelection} from "./integrationCatalogFilters"

type CatalogIntegration = ToolCatalogIntegration | ToolCatalogIntegrationDetails

export interface AgentIntegrationDrawerProps {
    open: boolean
    onClose: () => void
    /** The integrations the agent already holds — the added state and the current connection. */
    integrationRows: IntegrationRow[]
    /** Add an integration, or point a configured one at another connection. One write, one entry. */
    onAddIntegration: (target: GatewayConnectionTarget, connectionSlug: string) => void
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

/** Connections are shown by NAME. The slug is an identifier, not a label. */
const connectionLabel = (connection: ToolConnection | undefined): string =>
    connectionDisplayName(connection)

/** A row in "Connected in your workspace": quick-add, or open the connection chooser. */
function ConnectedRow({
    group,
    row,
    onAdd,
}: {
    group: ConnectedGroup
    /** The agent's row for this integration, in EITHER format, or undefined when it holds none. */
    row: IntegrationRow | undefined
    onAdd: (slug: string) => void
}) {
    const {integration} = useToolIntegrationDetail(group.integrationKey)
    const name = integration?.name || group.integrationKey
    const multiple = group.connections.length > 1
    const [choosing, setChoosing] = useState(false)
    const currentSlug = row?.entry?.connection
    const [selected, setSelected] = useState(() => currentSlug ?? group.connections[0]?.slug ?? "")
    const selectedName = connectionLabel(
        group.connections.find((connection) => connection.slug === selected) ??
            group.connections[0],
    )

    // Adding again would give one integration two model-facing surfaces, so one the agent already
    // holds offers no Add. Choosing another connection edits the entry, which an integration still
    // on the legacy per-action format does not have.
    const added = Boolean(row)
    const swappable = Boolean(row?.entry)
    const single = group.connections[0]

    const subtitle = choosing
        ? "Choose connection"
        : added && !swappable
          ? "Already added, in the old format"
          : multiple
            ? `${group.connections.length} connections`
            : connectionLabel(single)

    // An added integration offers Change only when it has an entry to edit; adding a second
    // surface to one still on the legacy format is never the intent.
    const chooserButton = multiple && (!added || swappable)

    return (
        <CatalogListRow
            highlighted={choosing}
            leading={<ProviderLogo logo={integration?.logo ?? null} size={20} />}
            title={name}
            titleSuffix={
                added && !choosing ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-[var(--ag-colorSuccessText)]">
                        <Check size={11} weight="bold" />
                        Added
                    </span>
                ) : !added && !multiple && !isConnectionValid(single) ? (
                    <span className="shrink-0 text-xs font-normal text-[var(--ag-colorWarningText)]">
                        needs reconnect
                    </span>
                ) : null
            }
            action={
                chooserButton ? (
                    <Button variant="outline" size="sm" onClick={() => setChoosing((v) => !v)}>
                        {choosing ? "Cancel" : added ? "Change" : "Add"}
                    </Button>
                ) : !added ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAdd(single.slug ?? "")}
                        disabled={!single.slug}
                    >
                        Add
                    </Button>
                ) : undefined
            }
            expansion={
                choosing ? (
                    <div className="ml-[30px] mt-2 flex flex-col gap-1">
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
                                        {connectionLabel(connection)}
                                    </span>
                                    {isConnectionValid(connection) ? null : (
                                        <span className="shrink-0 text-[var(--ag-colorWarningText)]">
                                            needs reconnect
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
                                    onAdd(selected)
                                    setChoosing(false)
                                }}
                            >
                                {added ? `Use ${selectedName}` : `Add with ${selectedName}`}
                            </Button>
                        </div>
                    </div>
                ) : null
            }
        >
            <span className="truncate text-xs text-[var(--ag-colorTextTertiary)]">{subtitle}</span>
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
    return (
        <CatalogListRow
            leading={<ProviderLogo logo={integration.logo ?? null} size={20} />}
            title={integration.name}
            action={
                <Button variant="outline" size="sm" onClick={onConnect}>
                    Connect
                </Button>
            }
        >
            <ExpandableDescription
                description={integration.description ?? undefined}
                label={integration.name}
            />
        </CatalogListRow>
    )
}

function CategoryRail({
    active,
    onSelect,
}: {
    active: string | null
    onSelect: (category: CategorySelection | null) => void
}) {
    const {categories, isLoading} = useToolCatalogCategories()
    return (
        // min-h-0: without it the rail's own content sets its height and the list never scrolls.
        <div className="flex min-h-0 w-44 shrink-0 flex-col gap-1 border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)] p-3">
            <span className="shrink-0 px-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Categories
            </span>
            <button
                type="button"
                onClick={() => onSelect(null)}
                className={`shrink-0 cursor-pointer rounded border-0 px-2 py-1 text-left text-[13px] [font-family:inherit] ${
                    active === null
                        ? "bg-[var(--ag-colorFillSecondary)] font-medium"
                        : "bg-transparent text-[var(--ag-colorTextSecondary)]"
                }`}
            >
                All apps
            </button>
            {isLoading ? <Spinner size="small" /> : null}
            {/* Only the categories scroll; the heading and All apps stay put. */}
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {categories.map((category) => (
                    <button
                        key={category.id}
                        type="button"
                        onClick={() => onSelect({id: category.id, name: category.name})}
                        className={`shrink-0 cursor-pointer truncate rounded border-0 px-2 py-1 text-left text-[13px] capitalize [font-family:inherit] ${
                            active === category.id
                                ? "bg-[var(--ag-colorFillSecondary)] font-medium"
                                : "bg-transparent text-[var(--ag-colorTextSecondary)]"
                        }`}
                    >
                        {category.name}
                    </button>
                ))}
            </div>
        </div>
    )
}

// Body — mounted only while the drawer is open (EnhancedDrawer destroyOnClose), so the catalog
// queries don't run in the background.
function IntegrationCatalogContent({
    integrationRows,
    onAddIntegration,
}: Omit<AgentIntegrationDrawerProps, "open" | "onClose">) {
    const [query, setQuery] = useState("")
    const [category, setCategoryState] = useState<CategorySelection | null>(null)
    const [connectTarget, setConnectTarget] = useState<CatalogIntegration | null>(null)
    // The integration a just-finished connect flow should land, once its connection shows up.
    const [pendingAdd, setPendingAdd] = useState<string | null>(null)

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
        () => new Map(integrationRows.map((row) => [groupKey(row.provider, row.integration), row])),
        [integrationRows],
    )

    const addIntegration = useCallback(
        (group: ConnectedGroup, slug: string) => {
            if (!slug) return
            onAddIntegration({provider: group.provider, integration: group.integrationKey}, slug)
        },
        [onAddIntegration],
    )

    // A connect flow reports success without naming the connection it made, so the add waits for
    // the refreshed list. One new connection for that integration is the unambiguous case; with
    // several the author picks in the chooser instead.
    //
    // The connect flow treats the provider popup closing as success, so an abandoned or failed
    // authorization can leave a connection that exists but does not work. Add only a connection
    // the project reports as valid; the row stays, with its reconnect hint, for the rest.
    useEffect(() => {
        if (!pendingAdd) return
        // The unfiltered list: a search typed before connecting must not hide the new connection.
        const group = allConnectedGroups.find((g) => g.integrationKey === pendingAdd)
        if (!group) return
        const only = group.connections.length === 1 ? group.connections[0] : null
        // Stay armed while the single connection is not valid YET: validity can arrive on a later
        // refresh, and the drawer is destroyed on close, so the intent cannot outlive the flow.
        if (only && !isConnectionValid(only)) return
        if (only) addIntegration(group, only.slug ?? "")
        setPendingAdd(null)
    }, [pendingAdd, allConnectedGroups, addIntegration])

    return (
        <div className="flex min-h-0 flex-1">
            <CategoryRail
                active={category?.id ?? null}
                onSelect={(next) => {
                    setCategoryState(next)
                    setCategory?.(next?.id ?? null)
                }}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <SearchInput placeholder="Search apps..." value={query} onValueChange={setQuery} />

                {connectedGroups.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <SubSectionHeader
                            label="Connected in your workspace"
                            count={connectedGroups.length}
                        />
                        <div className="overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
                            {connectedGroups.map((group) => (
                                <ConnectedRow
                                    key={groupKey(group.provider, group.integrationKey)}
                                    group={group}
                                    row={rowsByIntegration.get(
                                        groupKey(group.provider, group.integrationKey),
                                    )}
                                    onAdd={(slug) => addIntegration(group, slug)}
                                />
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="flex flex-col gap-2">
                    <SubSectionHeader label="All apps" count={total ?? catalogRows.length} />
                    {isLoading && integrations.length === 0 ? (
                        <div className="flex justify-center py-8">
                            <Spinner size="small" />
                        </div>
                    ) : catalogRows.length === 0 ? (
                        <span className="px-1 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                            No apps here.
                        </span>
                    ) : (
                        <div className="overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
                            {catalogRows.map((integration) => (
                                <CatalogRow
                                    key={integration.key}
                                    integration={integration}
                                    onConnect={() => setConnectTarget(integration)}
                                />
                            ))}
                        </div>
                    )}
                    <ScrollSentinel
                        onVisible={requestMore}
                        hasMore={hasNextPage}
                        isFetching={isFetchingNextPage}
                    />
                    {isFetchingNextPage ? (
                        <div className="flex justify-center py-2">
                            <Spinner size="small" />
                        </div>
                    ) : null}
                </div>
            </div>

            {connectTarget ? (
                <ConnectDrawer
                    open
                    integrationKey={connectTarget.key}
                    integrationName={connectTarget.name}
                    integrationLogo={connectTarget.logo ?? undefined}
                    integrationDescription={connectTarget.description ?? undefined}
                    authSchemes={
                        (connectTarget as {auth_schemes?: string[] | null}).auth_schemes ?? []
                    }
                    onClose={() => setConnectTarget(null)}
                    onSuccess={() => {
                        setPendingAdd(connectTarget.key)
                        setConnectTarget(null)
                    }}
                />
            ) : null}
        </div>
    )
}

export function AgentIntegrationDrawer({
    open,
    onClose,
    integrationRows,
    onAddIntegration,
}: AgentIntegrationDrawerProps) {
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={INTEGRATION_DRAWER_WIDTH}
            destroyOnClose
            title={
                <div className="flex items-center gap-2">
                    <Plugs size={16} />
                    <span className="text-sm font-medium">Add integration</span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <div className="flex items-center justify-end">
                    <Button variant="default" onClick={onClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <IntegrationCatalogContent
                integrationRows={integrationRows}
                onAddIntegration={onAddIntegration}
            />
        </EnhancedDrawer>
    )
}
