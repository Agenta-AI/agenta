/**
 * IntegrationCatalog
 *
 * Add WHOLE integrations to an agent. Adding one adds every tool the integration has; what the
 * author configures afterwards, from the integration's row, is the permission policy. There is no
 * per-action catalog here any more.
 *
 * Each connection is its own row. Two ways in, both landing the same entry: quick-add from a
 * connection the project already has, and Connect, which the host opens (the connect view) and
 * which stores a project connection; the catalog then adds the new connection.
 *
 * A new integration lands on "Allow all". "Use" on another connection of an integration that is
 * already configured REPLACES its entry, keeping the policy already set.
 *
 * Settings mounts the same list as its page (`layout="page"`), with the person's own accounts,
 * Run and the project switch as props.
 */
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    isConnectionActive,
    isConnectionDefault,
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
import {useUserDisplayName} from "@agenta/entities/shared"
import {createT, formatDate, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {connectionDisplayName} from "@agenta/shared/utils"
import {HeightCollapse, ScrollSentinel} from "@agenta/ui"
import {IconTile, SearchInput, SimpleTooltip} from "@agenta/ui/composed"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {
    Alert,
    Badge,
    Button,
    cn,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {
    ArrowsLeftRight,
    CaretRight,
    Check,
    MagnifyingGlass,
    Plus,
    Star,
} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {OwnerChip} from "../../../accounts/OwnerChip"
import {useConnectionsHeading} from "../../../accounts/OwnerField"
import type {CreatedConnection} from "../../../gatewayTool/components/ConnectForm"
import {FinishConnectionDialog} from "../../../gatewayTool/components/FinishConnectionDialog"
import {IntegrationConnectionDetail} from "../../../gatewayTool/components/IntegrationConnectionDetail"
import {useRefreshToolConnection} from "../../../gatewayTool/hooks/useRefreshToolConnection"
import {ProviderLogo, SubSectionHeader} from "../sectionGroups"
import type {GatewayConnectionTarget, IntegrationRow} from "../toolUtils"

import {CanvasGroupHeader} from "./CanvasGroupHeader"
import {CatalogListRow} from "./CatalogListRow"
import {CatalogGroupSkeleton, CatalogRowSkeleton} from "./CatalogRowSkeleton"
import {CategoryChips} from "./CategoryChips"
import {CategorySelect} from "./CategorySelect"
import {ConnectionActionConfirm, type ConnectionAction} from "./ConnectionActionConfirm"
import {ConnectionRowMenu, type ConnectionMenuItem} from "./ConnectionRowMenu"
import {
    catalogSections,
    filterConnectedGroups,
    type CategorySelection,
} from "./integrationCatalogFilters"

const tNow = createT(integrationDrawerCatalog)

type CatalogIntegration = ToolCatalogIntegration | ToolCatalogIntegrationDetails

/** A connection a connect form made, waiting to be valid before it is added. */
interface PendingConnect extends CreatedConnection {
    integrationKey: string
}

/** Whether "Connected" is folded away; remembered per viewer, one key for every host. */
const connectedCollapsedAtom = atomWithStorage(
    "agenta:agent-integrations:connected-collapsed",
    false,
)

/** Whether the person's own accounts are folded away; Settings' key, so the fold carries over. */
const yoursCollapsedAtom = atomWithStorage("agenta:settings:integrations-yours-collapsed", false)

/** Rows in two columns where they fit, one on a phone: the Settings page grid. */
const PAGE_ROWS = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-2"

/** What the catalog needs to add apps to an agent. Absent, it only browses and connects. */
export interface IntegrationCatalogAdding {
    /** The integrations the agent already holds — the added state and the current connection. */
    integrationRows: IntegrationRow[]
    /** Add an integration, or point a configured one at another connection. One write, one entry. */
    onAddIntegration: (target: GatewayConnectionTarget, connectionSlug: string) => void
    /** Add an integration that uses each person's own account. */
    onAddPersonalIntegration: (target: GatewayConnectionTarget) => void
}

/** The person's own accounts, as a first group (Settings). */
export interface IntegrationCatalogYours {
    label: string
    /** Under the group when it has no rows, outside a search. */
    empty: ReactNode
    /** Under the group when the read failed; it then replaces `empty`. */
    error?: ReactNode
    /** "Make default" on a working account that is not the default; `defaultLabel` marks it. */
    makeDefault: {
        label: string
        defaultLabel: string
        onMakeDefault: (connection: ToolConnection) => void
    }
}

export interface IntegrationCatalogProps {
    /** Adds apps to an agent; absent in a place with no agent (chat, playground, prompts). */
    adding?: IntegrationCatalogAdding
    /**
     * Open the connect form of an app. The form calls `onCreated` with the connection it made,
     * and the catalog adds that one once it is valid. A cancelled form calls nothing.
     */
    onConnect: (integrationKey: string, onCreated: (created: CreatedConnection) => void) => void
    /**
     * `panel` (default): a view body with its own scroll and a category select. `page`: the
     * page scrolls, the search sticks to its top, categories are chips, rows sit in two columns.
     */
    layout?: "panel" | "page"
    searchPlaceholder?: string
    /**
     * The project group's heading in place of "Connected", e.g. the Settings project switch. A
     * heading also pins the group: it does not fold and stays when empty, outside a search.
     */
    projectHeading?: ReactNode
    yours?: IntegrationCatalogYours
    /**
     * Takes over Revoke and Delete: the host asks in its own dialog AND runs the action. Absent,
     * the catalog asks and runs it.
     */
    confirmConnectionAction?: (action: ConnectionAction, connection: ToolConnection) => void
    /** Filters held by a host that draws its own toolbar (Settings); the catalog draws none. */
    /** Settings: whether this person may revoke or delete the project's connections. */
    canManageProject?: boolean
    controls?: IntegrationCatalogControls
    /** Rows above the groups, outside a search: the add list's create row ("Create with AI"). */
    leadingRows?: ReactNode
}

/** The catalog's filters, held by the host. */
export interface IntegrationCatalogControls {
    query: string
    category: CategorySelection | null
    /** Which connected groups show: the person's, the project's, or both. */
    owner: "all" | "user" | "project"
    /** Empties the host's search, for the no-match state. */
    onClearSearch?: () => void
}

/** One connection in "Connected", with the provider and integration it belongs to. */
interface ConnectedEntry {
    integrationKey: string
    provider: string
    connection: ToolConnection
}

/** The identity of an integration row is the PAIR; the integration alone merges two providers. */
const groupKey = (provider: string, integration: string): string => `${provider}:${integration}`

/** One entry per connection; an app's connections stay next to each other. */
function connectionEntries(connections: ToolConnection[]): ConnectedEntry[] {
    const byApp = new Map<string, ConnectedEntry[]>()
    for (const connection of connections) {
        if (!connection.integration_key || !connection.slug) continue
        const provider = connection.provider_key ?? "composio"
        const key = groupKey(provider, connection.integration_key)
        const entries = byApp.get(key) ?? []
        entries.push({integrationKey: connection.integration_key, provider, connection})
        byApp.set(key, entries)
    }
    return [...byApp.values()].flat()
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

/** The app logo in a two-line row's 32 px Mark; a brand logo sits on the white logo ground. */
function LogoTile({logo}: {logo: string | null}) {
    return (
        <IconTile size={32} className={logo ? "overflow-hidden bg-logo-ground" : undefined}>
            <ProviderLogo logo={logo} size={16} />
        </IconTile>
    )
}

/** What a row hands up for the drawer to run: a finish sign-in, or a confirmed verb. */
export interface ConnectionRowHandlers {
    onFinish: (connection: ToolConnection, name: string, logo: string | null) => void
    onRefresh: (connection: ToolConnection) => void
    onConfirm: (action: ConnectionAction, connection: ToolConnection, label: string) => void
    /** Settings: open a connection's detail. */
    onOpen?: (connection: ToolConnection, name: string, logo: string | null) => void
}

/** The host's verbs on one connection: Make default on the person's own. */
interface RowVerbs {
    makeDefault?: IntegrationCatalogYours["makeDefault"]
    /** False: Revoke and Delete are not offered (a read-only member on project rows). */
    manage?: boolean
}

const works = (connection: ToolConnection) =>
    isConnectionActive(connection) && isConnectionValid(connection)

const menuItems = (connection: ToolConnection, verbs: RowVerbs): ConnectionMenuItem[] => [
    ...(verbs.makeDefault && works(connection) && !isConnectionDefault(connection)
        ? [
              {
                  key: "make-default",
                  label: verbs.makeDefault.label,
                  icon: <Star />,
                  onSelect: () => verbs.makeDefault?.onMakeDefault(connection),
              },
          ]
        : []),
]

/** "Default" beside the person's default account. */
const DefaultMark = ({label}: {label: string}) => (
    <span className="shrink-0 text-meta font-normal text-muted-foreground">{label}</span>
)

/** When a connection was made: "Nov 19", with the year when it is not this year. */
const connectedDate = (value: string | null | undefined): string | null => {
    const at = value ? Date.parse(value) : Number.NaN
    if (Number.isNaN(at)) return null
    const thisYear = new Date(at).getFullYear() === new Date().getFullYear()
    return formatDate(at, {day: "numeric", month: "short", year: thisYear ? undefined : "numeric"})
}

/** One connection in "Connected": add it, switch the agent to it, or open it (Settings). */
function ConnectedRow({
    entry,
    row,
    onAdd,
    handlers,
    verbs = {},
    canvas = false,
    chip,
}: {
    /** The agent panel's row (canvas F02 f4); off, the Settings page row. */
    canvas?: boolean
    /** After the name, e.g. the owner chip in Settings' mixed list. */
    chip?: ReactNode
    entry: ConnectedEntry
    /** The agent's row for this integration, in EITHER format, or undefined when it holds none. */
    row: IntegrationRow | undefined
    /** Absent where nothing is added to an agent: the row only lists the connection. */
    onAdd?: (slug: string) => void
    handlers: ConnectionRowHandlers
    verbs?: RowVerbs
}) {
    const t = useT(integrationDrawerCatalog)
    const {integration} = useToolIntegrationDetail(entry.integrationKey)
    const {connection} = entry
    const name = integration?.name || entry.integrationKey
    const label = connectionLabel(connection, name)
    const logo = integration?.logo ?? null
    const slug = connection.slug ?? ""
    const attention = attentionOf(connection)
    const connectedBy = useUserDisplayName(connection.created_by_id)

    // A legacy per-action entry has no connection to switch, and adding again would give one
    // integration two model-facing surfaces.
    const legacy = Boolean(row) && !row?.entry
    const inUse = row?.entry
        ? row.entry.connection === slug
        : Boolean(row) && (!row?.legacyConnections.length || row.legacyConnections.includes(slug))
    const switchable = Boolean(onAdd) && Boolean(row?.entry) && !inUse

    const when = connectedDate(connection.created_at)
    const connectedText = when
        ? connectedBy
            ? t("entityUi.integrationDrawer.connectedByWhen", {name: connectedBy, when})
            : t("entityUi.integrationDrawer.connectedWhen", {when})
        : null
    // What tells same-named connections apart, without ids: the app, the sign-in, when and who.
    const subtitle =
        onAdd && legacy
            ? t("entityUi.integrationDrawer.alreadyAddedOldFormat")
            : [label === name ? null : name, authLabel(connection), connectedText]
                  .filter(Boolean)
                  .join(" · ")

    const attentionTag = attention
        ? attention === "inactive"
            ? t("entityUi.integrationDrawer.inactive")
            : t("entityUi.integrationDrawer.pending")
        : null
    const defaultMark =
        verbs.makeDefault && isConnectionDefault(connection) ? (
            <DefaultMark label={verbs.makeDefault.defaultLabel} />
        ) : null

    const statusSuffix = canvas ? (
        attentionTag ? (
            <Badge variant="warning" className="shrink-0">
                {attentionTag}
            </Badge>
        ) : (
            defaultMark
        )
    ) : inUse ? (
        <span className="flex shrink-0 items-center gap-1 text-meta font-normal text-success">
            <Check size={12} />
            {t("entityUi.integrationDrawer.added")}
        </span>
    ) : attentionTag ? (
        // Beside the name and never truncated, so the problem always shows.
        <span className="flex shrink-0 items-center gap-1.5 text-label font-medium text-warning">
            <span aria-hidden className="size-1.5 rounded-round bg-current" />
            {attentionTag}
        </span>
    ) : (
        defaultMark
    )

    return (
        <CatalogListRow
            actionLabel={onAdd ? t("entityUi.integrationDrawer.addName", {name: label}) : label}
            onClick={
                // As in Settings: a sign-in that never finished opens to finishing it.
                attention === "pending"
                    ? () => handlers.onFinish(connection, name, logo)
                    : onAdd && !row && slug
                      ? () => onAdd(slug)
                      : // Settings: a connection opens to its detail.
                        !onAdd && handlers.onOpen
                        ? () => handlers.onOpen?.(connection, name, logo)
                        : undefined
            }
            variant={canvas ? "canvas" : "default"}
            leading={<LogoTile logo={logo} />}
            title={label}
            titleSuffix={
                chip ? (
                    <span className="flex shrink-0 items-center gap-2">
                        {chip}
                        {statusSuffix}
                    </span>
                ) : (
                    statusSuffix
                )
            }
            action={
                <span className="flex items-center gap-1">
                    {/* "Added" only on a working connection; a pending or inactive one shows its
                        tag instead (canvas F02 f4). */}
                    {canvas && inUse && !attention ? (
                        <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                            <Check size={14} />
                            {t("entityUi.integrationDrawer.added")}
                        </span>
                    ) : null}
                    {switchable ? (
                        // An icon beside the row menu, the same size, with its word as the tooltip.
                        <SimpleTooltip title={t("entityUi.integrationDrawer.use")}>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("entityUi.integrationDrawer.use")}
                                className="text-muted-foreground hover:bg-secondary hover:text-foreground"
                                onClick={() => onAdd?.(slug)}
                            >
                                <ArrowsLeftRight />
                            </Button>
                        </SimpleTooltip>
                    ) : null}
                    {canvas && attention === "pending" ? (
                        <CaretRight size={12} className="shrink-0 text-muted-foreground" />
                    ) : null}
                    {/* Always shown, so nothing shifts when the row is hovered. */}
                    <span className="contents">
                        <ConnectionRowMenu
                            items={menuItems(connection, verbs)}
                            onRefresh={() => handlers.onRefresh(connection)}
                            onRevoke={
                                verbs.manage === false
                                    ? undefined
                                    : () => handlers.onConfirm("revoke", connection, label)
                            }
                            onDelete={
                                verbs.manage === false
                                    ? undefined
                                    : () => handlers.onConfirm("delete", connection, label)
                            }
                        />
                    </span>
                </span>
            }
        >
            {subtitle ? (
                <span className="truncate text-meta text-muted-foreground" title={subtitle}>
                    {subtitle}
                </span>
            ) : null}
        </CatalogListRow>
    )
}

/** A row in "All apps": an integration the project has no connection for yet. */
function CatalogRow({
    integration,
    onConnect,
    canvas = false,
}: {
    integration: CatalogIntegration
    onConnect: () => void
    /** The agent panel's row (canvas F02 f4). */
    canvas?: boolean
}) {
    const t = useT(integrationDrawerCatalog)
    return (
        <CatalogListRow
            onClick={onConnect}
            variant={canvas ? "canvas" : "default"}
            leading={<LogoTile logo={integration.logo ?? null} />}
            title={integration.name}
            actionLabel={t("entityUi.integrationDrawer.connectName", {name: integration.name})}
            action={
                <SimpleTooltip title={t("entityUi.integrationDrawer.connect")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        // The row menu's size and tone; shown on row hover and focus, always on touch.
                        className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0"
                        aria-label={t("entityUi.integrationDrawer.connectName", {
                            name: integration.name,
                        })}
                        onClick={onConnect}
                    >
                        <Plus />
                    </Button>
                </SimpleTooltip>
            }
        >
            {integration.description ? (
                // One line; the full text stays available on hover.
                <span
                    className="truncate text-meta text-muted-foreground"
                    title={integration.description}
                >
                    {integration.description}
                </span>
            ) : null}
        </CatalogListRow>
    )
}

/** A group of connection rows under its header; with `onToggle` the header folds them away. */
function RowGroup({
    label,
    count,
    collapsed = false,
    onToggle,
    page,
    footer,
    list = false,
    children,
}: {
    /** One row per line, like a table, in place of the page's two columns. */
    list?: boolean
    /** In the agent panel (not `page`) the header is the canvas one and the group never folds. */
    label: ReactNode
    count: number
    collapsed?: boolean
    onToggle?: () => void
    page: boolean
    footer?: ReactNode
    children: ReactNode
}) {
    return (
        // No gap: the spacing rides inside the collapse, so a folded list leaves none.
        <div className="flex flex-col">
            {page ? (
                <SubSectionHeader
                    label={label}
                    count={count}
                    collapsed={collapsed}
                    onToggle={onToggle}
                />
            ) : (
                <CanvasGroupHeader label={label} />
            )}
            {/* -mx/px: the rows' hover fill and focus ring bleed 8px past the column, and the
            collapse clips its overflow. */}
            <HeightCollapse
                open={!page || !collapsed}
                fade
                className="-mx-2"
                contentClassName={cn(
                    page && !list ? PAGE_ROWS : "flex flex-col gap-2",
                    "px-2 pt-2",
                )}
            >
                {children}
            </HeightCollapse>
            {page && collapsed ? null : footer}
        </div>
    )
}

/** The catalog: the project's connected apps, then all apps. Mounted only while it shows. */
export function IntegrationCatalog({
    adding,
    onConnect,
    layout = "panel",
    searchPlaceholder,
    projectHeading,
    yours,
    confirmConnectionAction,
    controls,
    canManageProject = true,
    leadingRows,
}: IntegrationCatalogProps) {
    const connectionsHeading = useConnectionsHeading()
    const t = useT(integrationDrawerCatalog, commonCatalog)
    const page = layout === "page"
    // The catalog's own box: in a panel its dialogs and the category list open inside it, so they
    // stay in a drawer host and scroll under the drawer's lock. On a page they open over the page.
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    const dialogContainer = page ? null : container
    const [ownQuery, setQuery] = useState("")
    const [ownCategory, setCategoryState] = useState<CategorySelection | null>(null)
    const query = controls?.query ?? ownQuery
    const category = controls ? controls.category : ownCategory
    const [connectedCollapsed, setConnectedCollapsed] = useAtom(connectedCollapsedAtom)
    const [yoursCollapsed, setYoursCollapsed] = useAtom(yoursCollapsedAtom)
    // Fades the list's top and bottom edges while there is more to scroll that way.
    const listRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(listRef, {enabled: !page})
    // A search always shows what it matched.
    const searching = query.trim().length > 0
    // The connection a connect form made, until it is valid and added.
    const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null)
    const {connections: personalConnections} = usePersonalToolConnections()
    // The rows' Settings verbs: finish a pending sign-in, or confirm a revoke or delete.
    const [detail, setDetail] = useState<{
        connection: ToolConnection
        name: string
        logo: string | null
    } | null>(null)
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
    const confirmAction = useCallback(
        (action: ConnectionAction, connection: ToolConnection, label: string) =>
            confirmConnectionAction
                ? confirmConnectionAction(action, connection)
                : setConfirming({action, connection, label}),
        [confirmConnectionAction],
    )
    const refreshConnection = useRefreshToolConnection()
    const {handleDelete, handleRevoke} = useToolConnectionActions()
    const rowHandlers = useMemo<ConnectionRowHandlers>(
        () => ({
            onFinish: (connection, name, logo) => setFinishing({connection, name, logo}),
            onRefresh: (connection) => void refreshConnection(connection),
            onConfirm: confirmAction,
            onOpen: page
                ? (connection, name, logo) => setDetail({connection, name, logo})
                : undefined,
        }),
        [refreshConnection, confirmAction, page],
    )
    const projectVerbs = useMemo<RowVerbs>(() => ({manage: canManageProject}), [canManageProject])
    const yoursVerbs = useMemo<RowVerbs>(() => ({makeDefault: yours?.makeDefault}), [yours])

    const setSearch = useSetAtom(toolIntegrationsSearchAtom)
    const {
        integrations,
        total,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error: catalogError,
        refetch: refetchCatalog,
        requestMore,
        setCategory,
    } = useToolCatalogIntegrations()
    const {connections, isLoading: connectionsLoading} = useToolConnectionsQuery()

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
    const selectCategory = (next: CategorySelection | null) => {
        setCategoryState(next)
        setCategory?.(next?.id ?? null)
    }
    const controlledCategoryId = controls ? (controls.category?.id ?? null) : undefined
    useEffect(() => {
        if (controlledCategoryId !== undefined) setCategory?.(controlledCategoryId)
    }, [controlledCategoryId, setCategory])
    const showsOwner = (owner: "user" | "project") =>
        !controls || controls.owner === "all" || controls.owner === owner

    const allConnectedEntries = useMemo(() => connectionEntries(connections), [connections])
    const showsYours = Boolean(yours)
    const allYoursEntries = useMemo(
        () => (showsYours ? connectionEntries(personalConnections ?? []) : []),
        [showsYours, personalConnections],
    )

    // Read through the SAME query atoms each row uses, so this shares their cache.
    // Keyed by the joined keys: a new atom on every render would subscribe again and loop.
    const connectedKeys = [
        ...new Set(
            [...allConnectedEntries, ...allYoursEntries].map((entry) => entry.integrationKey),
        ),
    ]
        .sort()
        .join("\n")
    const connectedDetailsAtom = useMemo(
        () =>
            atom((get) =>
                (connectedKeys ? connectedKeys.split("\n") : []).map((key) => ({
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
    const {connected: connectedEntries, connectable: allRows} = useMemo(
        () =>
            catalogSections({
                integrations,
                groups: allConnectedEntries,
                query,
                category,
                categoriesByIntegration,
                namesByIntegration,
            }),
        [
            integrations,
            allConnectedEntries,
            query,
            category,
            categoriesByIntegration,
            namesByIntegration,
        ],
    )
    // Below three characters the server does not search, so narrow what has loaded.
    const narrowedLocally = searching && query.trim().length < 3
    const catalogRows = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle || needle.length >= 3) return allRows
        return allRows.filter((integration) =>
            [integration.name, integration.description].some((text) =>
                text?.toLowerCase().includes(needle),
            ),
        )
    }, [allRows, query])
    const yoursEntries = useMemo(
        () =>
            filterConnectedGroups({
                groups: allYoursEntries,
                query,
                category,
                categoriesByIntegration,
                namesByIntegration,
            }),
        [allYoursEntries, query, category, categoriesByIntegration, namesByIntegration],
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
    // A failed read says so and offers Retry, never "no apps match" (STATE-03).
    const catalogFailed = Boolean(catalogError) && integrations.length === 0
    const nothingFound =
        !catalogLoading &&
        !catalogFailed &&
        connectedEntries.length === 0 &&
        yoursEntries.length === 0 &&
        catalogRows.length === 0 &&
        // More pages may still hold a match for a local narrowing.
        !hasNextPage
    // A heading such as the project switch pins its group, until it loads or while a search or a
    // category shows only what it matched (no pinned heading, no empty note).
    const filtering = searching || category !== null
    const showConnected =
        connectedEntries.length > 0 ||
        (Boolean(projectHeading) && !filtering && !connectionsLoading)
    const yoursFooter =
        yours?.error ?? (!filtering && yoursEntries.length === 0 ? yours?.empty : null)

    // Settings' Connected footer: a failed personal read on every tab, the empty note on Personal.
    const connectedFooter = !showsOwner("user")
        ? null
        : (yours?.error ?? (controls?.owner === "user" ? yoursFooter : null))

    const search = (
        <SearchInput
            // The kit owns height, radius and text (SIZE-01, TOUCH-01).
            className={cn("min-w-0 flex-1", !page && "border-border-muted")}
            placeholder={searchPlaceholder ?? t("entityUi.integrationDrawer.searchApps")}
            value={query}
            onValueChange={setQuery}
        />
    )

    const renderRows = (entries: ConnectedEntry[], verbs: RowVerbs, chip?: ReactNode) =>
        entries.map((entry) => (
            <ConnectedRow
                key={`${groupKey(entry.provider, entry.integrationKey)}:${entry.connection.slug}`}
                entry={entry}
                row={rowsByIntegration.get(groupKey(entry.provider, entry.integrationKey))}
                onAdd={
                    adding
                        ? (slug) =>
                              slug &&
                              adding.onAddIntegration(
                                  {provider: entry.provider, integration: entry.integrationKey},
                                  slug,
                              )
                        : undefined
                }
                handlers={rowHandlers}
                verbs={verbs}
                canvas={!page}
                chip={chip}
            />
        ))

    return (
        <div
            ref={setContainer}
            className={page ? "flex min-w-0 flex-col" : "relative flex min-h-0 flex-1"}
        >
            {/* One column: the category filter sits beside the search, so apps get the width. */}
            {/* min-w-0: without it the one-line descriptions stretch the column past the drawer. */}
            <div className={page ? "flex flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
                {controls ? null : page ? (
                    // Pinned to the page's top while it scrolls, as Settings pins its search.
                    <div className="sticky top-0 z-10 -mx-3 bg-background px-3 pb-3 pt-1">
                        <div className="flex">{search}</div>
                        <CategoryChips value={category} onChange={selectCategory} />
                    </div>
                ) : (
                    // Fixed above the scroll. pt-1 keeps the focus ring inside the body's clip.
                    <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                        {search}
                        <div className="shrink-0">
                            <CategorySelect
                                value={category}
                                container={container}
                                onChange={selectCategory}
                            />
                        </div>
                    </div>
                )}

                <div
                    ref={listRef}
                    className={
                        page
                            ? // 12px on a phone, so the pinned bar does not cover the first
                              // heading's 44px tap area.
                              "flex flex-col gap-8 pt-2 max-md:pt-3"
                            : "ag-scroll-fade flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4"
                    }
                >
                    {leadingRows && !filtering ? leadingRows : null}
                    {controls ? (
                        // Settings: one Connected grid, as All apps, narrow owners first, chips in All.
                        (showsOwner("user") && yoursEntries.length > 0) ||
                        (showsOwner("project") && connectedEntries.length > 0) ||
                        connectedFooter ? (
                            <RowGroup
                                // With an owner segment the heading names the tab, as "Personal connections".
                                label={
                                    yours
                                        ? connectionsHeading(controls.owner)
                                        : t("entityUi.integrationDrawer.connected")
                                }
                                count={
                                    (showsOwner("user") ? yoursEntries.length : 0) +
                                    (showsOwner("project") ? connectedEntries.length : 0)
                                }
                                page={page}
                                footer={
                                    connectedFooter ? (
                                        <div className="pt-2">{connectedFooter}</div>
                                    ) : null
                                }
                            >
                                {showsOwner("user")
                                    ? renderRows(
                                          yoursEntries,
                                          yoursVerbs,
                                          yours && controls.owner === "all" ? (
                                              <OwnerChip owner="user" />
                                          ) : undefined,
                                      )
                                    : null}
                                {showsOwner("project")
                                    ? renderRows(
                                          connectedEntries,
                                          projectVerbs,
                                          yours && controls.owner === "all" ? (
                                              <OwnerChip owner="project" />
                                          ) : undefined,
                                      )
                                    : null}
                            </RowGroup>
                        ) : null
                    ) : (
                        <>
                            {yours &&
                            showsOwner("user") &&
                            (yoursEntries.length > 0 || yoursFooter) ? (
                                <RowGroup
                                    label={yours.label}
                                    count={yoursEntries.length}
                                    collapsed={!searching && yoursCollapsed}
                                    onToggle={
                                        searching
                                            ? undefined
                                            : () => setYoursCollapsed((value) => !value)
                                    }
                                    page={page}
                                    footer={
                                        yoursFooter ? (
                                            <div className="pt-2">{yoursFooter}</div>
                                        ) : null
                                    }
                                >
                                    {renderRows(yoursEntries, yoursVerbs)}
                                </RowGroup>
                            ) : null}

                            {showConnected && showsOwner("project") ? (
                                <RowGroup
                                    label={
                                        projectHeading ?? t("entityUi.integrationDrawer.connected")
                                    }
                                    count={connectedEntries.length}
                                    collapsed={!projectHeading && !searching && connectedCollapsed}
                                    onToggle={
                                        projectHeading || searching
                                            ? undefined
                                            : () => setConnectedCollapsed((value) => !value)
                                    }
                                    page={page}
                                >
                                    {renderRows(connectedEntries, projectVerbs)}
                                </RowGroup>
                            ) : !page && !filtering && connectionsLoading ? (
                                // Connected keeps its place while it loads; All apps does not move.
                                <CatalogGroupSkeleton rows={3} />
                            ) : null}
                        </>
                    )}

                    {catalogFailed ? (
                        <Alert
                            type="warning"
                            showIcon
                            message={t("entityUi.integrationDrawer.appsUnavailable")}
                            description={
                                <div className="flex items-start justify-between gap-4">
                                    <span>
                                        {t("entityUi.integrationDrawer.appsUnavailableDetail")}
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0"
                                        onClick={() => void refetchCatalog()}
                                    >
                                        {t("common.retry")}
                                    </Button>
                                </div>
                            }
                        />
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
                            {query.trim() && (!controls || controls.onClearSearch) ? (
                                <EmptyContent>
                                    <Button
                                        variant="outline"
                                        onClick={() =>
                                            controls ? controls.onClearSearch?.() : setQuery("")
                                        }
                                    >
                                        {t("common.clearSearch")}
                                    </Button>
                                </EmptyContent>
                            ) : null}
                        </Empty>
                    ) : null}

                    {/* Hidden when empty: the Connected matches, or the empty state, say it all. */}
                    {catalogLoading || catalogRows.length > 0 || hasNextPage ? (
                        <div className="flex flex-col gap-2">
                            {page ? (
                                <SubSectionHeader
                                    label={t("entityUi.integrationDrawer.allApps")}
                                    // A local narrowing shows fewer rows than the server total.
                                    count={
                                        catalogLoading || narrowedLocally
                                            ? undefined
                                            : (total ?? catalogRows.length)
                                    }
                                />
                            ) : (
                                <CanvasGroupHeader
                                    label={t("entityUi.integrationDrawer.allApps")}
                                />
                            )}
                            {catalogLoading ? (
                                <CatalogRowSkeleton />
                            ) : (
                                <div className={page ? PAGE_ROWS : "flex flex-col gap-2"}>
                                    {catalogRows.map((integration) => (
                                        <CatalogRow
                                            key={integration.key}
                                            canvas={!page}
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

            {detail ? (
                <IntegrationConnectionDetail
                    connection={detail.connection}
                    name={detail.name}
                    logo={detail.logo}
                    onReconnect={() => void refreshConnection(detail.connection)}
                    onClosed={() => setDetail(null)}
                />
            ) : null}
            {finishing ? (
                <FinishConnectionDialog
                    open
                    container={dialogContainer}
                    name={finishing.name}
                    apiKey={finishing.connection.data?.auth_scheme === "api_key"}
                    logo={<ProviderLogo logo={finishing.logo} size={18} />}
                    onAuthorize={() => refreshConnection(finishing.connection)}
                    onDelete={() =>
                        confirmAction(
                            "delete",
                            finishing.connection,
                            connectionLabel(finishing.connection, finishing.name),
                        )
                    }
                    onClose={() => setFinishing(null)}
                />
            ) : null}
            {confirming ? (
                <ConnectionActionConfirm
                    action={confirming.action}
                    name={confirming.label}
                    container={dialogContainer}
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
