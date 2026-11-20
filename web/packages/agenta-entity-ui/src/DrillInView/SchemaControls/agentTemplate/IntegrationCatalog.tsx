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
    cn,
} from "@agenta/ui/ui"
import {CaretRight, Check, MagnifyingGlass, Play, Plus, Star} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {CreatedConnection} from "../../../gatewayTool/components/ConnectForm"
import {FinishConnectionDialog} from "../../../gatewayTool/components/FinishConnectionDialog"
import {useRefreshToolConnection} from "../../../gatewayTool/hooks/useRefreshToolConnection"
import {ProviderLogo, SubSectionHeader} from "../sectionGroups"
import type {GatewayConnectionTarget, IntegrationRow} from "../toolUtils"

import {CatalogListRow} from "./CatalogListRow"
import {CatalogRowSkeleton} from "./CatalogRowSkeleton"
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
const PAGE_ROWS = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8"

/** What the catalog needs to add apps to an agent. Absent, it only browses and connects. */
export interface IntegrationCatalogAdding {
    /** The integrations the agent already holds — the added state and the current connection. */
    integrationRows: IntegrationRow[]
    /** Add an integration, or point a configured one at another connection. One write, one entry. */
    onAddIntegration: (target: GatewayConnectionTarget, connectionSlug: string) => void
    /** Add an integration that uses each person's own account. */
    onAddPersonalIntegration: (target: GatewayConnectionTarget) => void
}

/** Run a project connection's tool (Settings): a row click and a menu item. */
export interface IntegrationCatalogRun {
    label: string
    onRun: (connection: ToolConnection) => void
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
    run?: IntegrationCatalogRun
    /**
     * Takes over Revoke and Delete: the host asks in its own dialog AND runs the action. Absent,
     * the catalog asks and runs it.
     */
    confirmConnectionAction?: (action: ConnectionAction, connection: ToolConnection) => void
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

/** The host's verbs on one connection: Run on a project row, Make default on the person's own. */
interface RowVerbs {
    run?: IntegrationCatalogRun
    makeDefault?: IntegrationCatalogYours["makeDefault"]
}

const works = (connection: ToolConnection) =>
    isConnectionActive(connection) && isConnectionValid(connection)

const menuItems = (connection: ToolConnection, verbs: RowVerbs): ConnectionMenuItem[] => [
    ...(verbs.run
        ? [
              {
                  key: "run",
                  label: verbs.run.label,
                  icon: <Play size={14} />,
                  onSelect: () => verbs.run?.onRun(connection),
              },
          ]
        : []),
    ...(verbs.makeDefault && works(connection) && !isConnectionDefault(connection)
        ? [
              {
                  key: "make-default",
                  label: verbs.makeDefault.label,
                  icon: <Star size={14} />,
                  onSelect: () => verbs.makeDefault?.onMakeDefault(connection),
              },
          ]
        : []),
]

/** "Default" beside the person's default account. */
const DefaultMark = ({label}: {label: string}) => (
    <span className="shrink-0 text-xs font-normal text-[var(--ag-colorTextTertiary)]">{label}</span>
)

/** A row in "Connected in your workspace": quick-add, or open the connection chooser. */
function ConnectedRow({
    group,
    row,
    onAdd,
    handlers,
    verbs = {},
    canvas = false,
}: {
    /** The agent panel's row (canvas F02 f4); off, the Settings page row. */
    canvas?: boolean
    group: ConnectedGroup
    /** The agent's row for this integration, in EITHER format, or undefined when it holds none. */
    row: IntegrationRow | undefined
    /** Absent where nothing is added to an agent: the row only lists the connection. */
    onAdd?: (slug: string) => void
    handlers: ConnectionRowHandlers
    verbs?: RowVerbs
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
    const singleLabel = connectionLabel(single, integration?.name)

    const logo = integration?.logo ?? null
    // One connection reads as Settings reads it: the connection's own name, then "App · Auth".
    const attention = multiple ? null : attentionOf(single)
    // The panel names the app and puts the account under it (canvas F02 f4).
    const title = multiple || canvas ? name : singleLabel

    const subtitle =
        choosing && onAdd
            ? t("entityUi.integrationDrawer.chooseConnection")
            : added && !swappable
              ? t("entityUi.integrationDrawer.alreadyAddedOldFormat")
              : multiple
                ? t("entityUi.integrationDrawer.connectionCount", {count: group.connections.length})
                : canvas
                  ? singleLabel
                  : // What the app does says more than repeating its name; the old line is the fallback.
                    integration?.description?.trim() ||
                    [name, authLabel(single)].filter(Boolean).join(" · ")

    // An added integration offers Change only when it has an entry to edit; adding a second
    // surface to one still on the legacy format is never the intent.
    const chooserButton = Boolean(onAdd) && multiple && (!added || swappable)
    // With no agent, an app with several connections opens to manage each one.
    const browseList = !onAdd && multiple

    // Adding is the row's own click; only switching connections needs a visible button.
    const rowAction =
        chooserButton && (choosing || added) ? (
            <Button
                variant={canvas ? "outline" : "ghost"}
                size={canvas ? "compact" : "sm"}
                className={canvas ? "font-normal" : undefined}
                onClick={() => setChoosing((v) => !v)}
            >
                {choosing
                    ? t("entityUi.integrationDrawer.cancel")
                    : t("entityUi.integrationDrawer.change")}
            </Button>
        ) : null

    return (
        <CatalogListRow
            highlighted={choosing && (Boolean(onAdd) || browseList)}
            actionLabel={onAdd ? t("entityUi.integrationDrawer.addName", {name}) : name}
            onClick={
                choosing && onAdd
                    ? undefined
                    : // As in Settings: a sign-in that never finished opens to finishing it.
                      attention === "pending"
                      ? () => handlers.onFinish(single, name, logo)
                      : chooserButton || browseList
                        ? () => setChoosing((value) => !value)
                        : onAdd && !added && single.slug
                          ? () => onAdd(single.slug ?? "")
                          : // Settings: a project connection opens to running its tools.
                            !onAdd && verbs.run
                            ? () => verbs.run?.onRun(single)
                            : undefined
            }
            variant={canvas ? "canvas" : "default"}
            leading={canvas ? <ProviderLogo logo={logo} size={20} /> : <LogoTile logo={logo} />}
            title={title}
            titleSuffix={
                canvas ? (
                    attention ? (
                        <span className="inline-flex h-5 shrink-0 items-center rounded px-[7px] text-[12px] font-medium leading-4 text-colorWarningText bg-colorWarningBg">
                            {attention === "inactive"
                                ? t("entityUi.integrationDrawer.inactive")
                                : t("entityUi.integrationDrawer.pending")}
                        </span>
                    ) : !multiple && verbs.makeDefault && isConnectionDefault(single) ? (
                        <DefaultMark label={verbs.makeDefault.defaultLabel} />
                    ) : null
                ) : added && !choosing ? (
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
                ) : !multiple && verbs.makeDefault && isConnectionDefault(single) ? (
                    <DefaultMark label={verbs.makeDefault.defaultLabel} />
                ) : null
            }
            action={
                <span className={`flex items-center ${canvas ? "gap-2" : "gap-0.5"}`}>
                    {canvas && added && !choosing ? (
                        <span className="flex shrink-0 items-center gap-1 text-[12px] leading-4 text-colorTextSecondary">
                            <Check size={14} />
                            {t("entityUi.integrationDrawer.added")}
                        </span>
                    ) : null}
                    {rowAction}
                    {canvas && attention === "pending" ? (
                        <CaretRight size={12} className="shrink-0 text-colorTextTertiary" />
                    ) : null}
                    {/* Per-connection verbs need one connection to act on. In the panel they take
                        no room until the row is hovered or focused; touch shows them always. */}
                    {multiple ? null : (
                        <span
                            className={
                                canvas
                                    ? // Zero width, not hidden, so Tab still reaches the menu button;
                                      // -ml-2 takes back the row's gap while it is closed.
                                      "-ml-2 flex max-w-0 overflow-hidden group-focus-within/row:ml-0 group-focus-within/row:max-w-none group-hover/row:ml-0 group-hover/row:max-w-none has-[[data-state=open]]:ml-0 has-[[data-state=open]]:max-w-none [@media(hover:none)]:ml-0 [@media(hover:none)]:max-w-none"
                                    : "contents"
                            }
                        >
                            <ConnectionRowMenu
                                items={menuItems(single, verbs)}
                                onRefresh={() => handlers.onRefresh(single)}
                                onRevoke={() => handlers.onConfirm("revoke", single, singleLabel)}
                                onDelete={() => handlers.onConfirm("delete", single, singleLabel)}
                            />
                        </span>
                    )}
                </span>
            }
            expansion={
                choosing && browseList ? (
                    <div className="ml-[42px] mt-2 flex flex-col gap-1">
                        {group.connections.map((connection) => {
                            const label = connectionLabel(connection, integration?.name)
                            const pending = attentionOf(connection) === "pending"
                            return (
                                <div
                                    key={connection.slug}
                                    className="flex items-center gap-2 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-2.5 py-1 text-xs"
                                >
                                    <span className="flex-1 truncate">{label}</span>
                                    {verbs.makeDefault && isConnectionDefault(connection) ? (
                                        <DefaultMark label={verbs.makeDefault.defaultLabel} />
                                    ) : null}
                                    {pending ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                handlers.onFinish(connection, name, logo)
                                            }
                                        >
                                            {t("entityUi.integrationDrawer.pending")}
                                        </Button>
                                    ) : isConnectionValid(connection) ? null : (
                                        <span className="shrink-0 text-[var(--ag-colorWarningText)]">
                                            {t("entityUi.integrationDrawer.needsReconnect")}
                                        </span>
                                    )}
                                    <ConnectionRowMenu
                                        items={menuItems(connection, verbs)}
                                        onRefresh={() => handlers.onRefresh(connection)}
                                        onRevoke={() =>
                                            handlers.onConfirm("revoke", connection, label)
                                        }
                                        onDelete={() =>
                                            handlers.onConfirm("delete", connection, label)
                                        }
                                    />
                                </div>
                            )
                        })}
                    </div>
                ) : choosing && onAdd ? (
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
            <span
                className={
                    canvas
                        ? "truncate text-[12px] leading-4 text-colorTextSecondary"
                        : "truncate text-xs text-[var(--ag-colorTextTertiary)]"
                }
                title={subtitle}
            >
                {subtitle}
            </span>
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
            leading={
                canvas ? (
                    <ProviderLogo logo={integration.logo ?? null} size={20} />
                ) : (
                    <LogoTile logo={integration.logo ?? null} />
                )
            }
            title={integration.name}
            actionLabel={t("entityUi.integrationDrawer.connectName", {name: integration.name})}
            action={
                <Button
                    variant="ghost"
                    size={canvas ? "icon-compact" : "icon-sm"}
                    aria-label={t("entityUi.integrationDrawer.connectName", {
                        name: integration.name,
                    })}
                    title={t("entityUi.integrationDrawer.connect")}
                    onClick={onConnect}
                >
                    {canvas ? <Plus className="size-3.5 max-md:size-5" /> : <Plus size={16} />}
                </Button>
            }
        >
            {integration.description ? (
                // One line; the full text stays available on hover.
                <span
                    className={
                        canvas
                            ? "truncate text-[12px] leading-4 text-colorTextSecondary"
                            : "truncate text-xs text-[var(--ag-colorTextTertiary)]"
                    }
                    title={integration.description}
                >
                    {integration.description}
                </span>
            ) : null}
        </CatalogListRow>
    )
}

/** The agent panel's group header (canvas F02 f4): 13/600, a divider above, no count, no fold. */
function CanvasGroupHeader({label}: {label: ReactNode}) {
    return (
        <div className="mt-0.5 flex items-center border-0 border-t border-solid border-[var(--ag-colorSplit)] pb-0.5 pt-2 text-[13px] font-semibold leading-5 text-colorText">
            {label}
        </div>
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
    children,
}: {
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
                contentClassName={cn(page ? PAGE_ROWS : "flex flex-col gap-2", "px-2 pt-2")}
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
    run,
    confirmConnectionAction,
}: IntegrationCatalogProps) {
    const t = useT(integrationDrawerCatalog)
    const page = layout === "page"
    // The catalog's own box: in a panel its dialogs and the category list open inside it, so they
    // stay in a drawer host and scroll under the drawer's lock. On a page they open over the page.
    const [container, setContainer] = useState<HTMLDivElement | null>(null)
    const dialogContainer = page ? null : container
    const [query, setQuery] = useState("")
    const [category, setCategoryState] = useState<CategorySelection | null>(null)
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
        }),
        [refreshConnection, confirmAction],
    )
    const projectVerbs = useMemo<RowVerbs>(() => ({run}), [run])
    const yoursVerbs = useMemo<RowVerbs>(() => ({makeDefault: yours?.makeDefault}), [yours])

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

    const allConnectedGroups = useMemo(() => groupConnections(connections), [connections])
    const showsYours = Boolean(yours)
    const allYoursGroups = useMemo(
        () => (showsYours ? groupConnections(personalConnections ?? []) : []),
        [showsYours, personalConnections],
    )

    // Read through the SAME query atoms each row uses, so this shares their cache.
    // Keyed by the joined keys: a new atom on every render would subscribe again and loop.
    const connectedKeys = [
        ...new Set([...allConnectedGroups, ...allYoursGroups].map((group) => group.integrationKey)),
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
    const {connected: connectedGroups, connectable: allRows} = useMemo(
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
    const yoursGroups = useMemo(
        () =>
            filterConnectedGroups({
                groups: allYoursGroups,
                query,
                category,
                categoriesByIntegration,
                namesByIntegration,
            }),
        [allYoursGroups, query, category, categoriesByIntegration, namesByIntegration],
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
    const nothingFound =
        !catalogLoading &&
        connectedGroups.length === 0 &&
        yoursGroups.length === 0 &&
        catalogRows.length === 0 &&
        // More pages may still hold a match for a local narrowing.
        !hasNextPage
    // A heading such as the project switch pins its group, until it loads or while a search or a
    // category shows only what it matched (no pinned heading, no empty note).
    const filtering = searching || category !== null
    const showConnected =
        connectedGroups.length > 0 || (Boolean(projectHeading) && !filtering && !connectionsLoading)
    const yoursFooter =
        yours?.error ?? (!filtering && yoursGroups.length === 0 ? yours?.empty : null)

    const search = (
        <SearchInput
            className={cn(
                "min-w-0 flex-1",
                // Canvas F02 f4: 30 px, radius 6, 13 px; 44 px on a phone.
                !page &&
                    "h-[30px] rounded-[6px] border-colorBorderSecondary max-md:h-11 md:[&_input]:text-[13px]",
            )}
            placeholder={searchPlaceholder ?? t("entityUi.integrationDrawer.searchApps")}
            value={query}
            onValueChange={setQuery}
        />
    )

    const renderRows = (groups: ConnectedGroup[], verbs: RowVerbs) =>
        groups.map((group) => (
            <ConnectedRow
                key={groupKey(group.provider, group.integrationKey)}
                group={group}
                row={rowsByIntegration.get(groupKey(group.provider, group.integrationKey))}
                onAdd={
                    adding
                        ? (slug) =>
                              slug &&
                              adding.onAddIntegration(
                                  {provider: group.provider, integration: group.integrationKey},
                                  slug,
                              )
                        : undefined
                }
                handlers={rowHandlers}
                verbs={verbs}
                canvas={!page}
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
                {page ? (
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
                            ? "flex flex-col gap-8 pt-2"
                            : "ag-scroll-fade flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4"
                    }
                >
                    {yours && (yoursGroups.length > 0 || yoursFooter) ? (
                        <RowGroup
                            label={yours.label}
                            count={yoursGroups.length}
                            collapsed={!searching && yoursCollapsed}
                            onToggle={
                                searching ? undefined : () => setYoursCollapsed((value) => !value)
                            }
                            page={page}
                            footer={yoursFooter ? <div className="pt-2">{yoursFooter}</div> : null}
                        >
                            {renderRows(yoursGroups, yoursVerbs)}
                        </RowGroup>
                    ) : null}

                    {showConnected ? (
                        <RowGroup
                            label={projectHeading ?? t("entityUi.integrationDrawer.connected")}
                            count={connectedGroups.length}
                            collapsed={!projectHeading && !searching && connectedCollapsed}
                            onToggle={
                                projectHeading || searching
                                    ? undefined
                                    : () => setConnectedCollapsed((value) => !value)
                            }
                            page={page}
                        >
                            {renderRows(connectedGroups, projectVerbs)}
                        </RowGroup>
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

            {finishing ? (
                <FinishConnectionDialog
                    open
                    container={dialogContainer}
                    name={finishing.name}
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
