/**
 * CatalogChooser
 *
 * The Composio app/source chooser — the EXACT inner content from the subscription drawer's
 * "Choose a trigger" step (a "Your connections" rail + a responsive 2-column "All apps" grid with
 * the good infinite scroll + an app detail panel). Extracted so the tools "Third-party integration"
 * flow renders the SAME component and layout, differing only by the per-app item leaf (pick an event
 * → subscription vs. add an action → tool), supplied via props.
 *
 * Consumers wrap this in their own drawer/section. Dark-safe (`--ag-color*` tokens).
 */
import {useEffect, useMemo, useState, type ReactNode} from "react"

import {ScrollSentinel} from "@agenta/ui"
import {ArrowClockwise, ArrowLeft, Check, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {Button, Input, Spin, Tooltip, Typography} from "antd"

import {AppCard, AppLogo} from "./CatalogAppCard"

export type CatalogItemState = "add" | "selected" | "pending"

export interface CatalogChooserProps<I, T, C> {
    connections: C[]
    /** Whether a connection is authenticated and usable (green dot). A connection can exist
     * (record created) yet not be ready — OAuth pending/abandoned — which shows an amber dot. */
    isConnectionReady: (c: C) => boolean
    useIntegrations: () => {
        integrations: I[]
        hasNextPage: boolean
        isFetchingNextPage: boolean
        isLoading: boolean
        requestMore: () => void
        setSearch: (s: string) => void
    }
    useItems: (integrationKey: string) => {
        items: T[]
        isLoading: boolean
        hasNextPage: boolean
        isFetchingNextPage: boolean
        requestMore: () => void
        /** Server-side item search (drives the paginated query). */
        setSearch: (s: string) => void
    }
    integration: {
        key: (i: I) => string
        name: (i: I) => string
        logo: (i: I) => string | null | undefined
        description: (i: I) => string | null | undefined
        categories: (i: I) => string[] | undefined
        actionsCount: (i: I) => number | null | undefined
    }
    connection: {
        id: (c: C) => string | undefined
        name: (c: C) => string | undefined
        slug: (c: C) => string | undefined
        integrationKey: (c: C) => string
        connectedAt?: (c: C) => string | undefined
    }
    item: {
        key: (t: T) => string
        name: (t: T) => string | undefined
        /** Secondary description line for an item row (optional — omitted rows show name only). */
        description?: (t: T) => string | null | undefined
        /** Category chips for an item row (e.g. an action's `["CI/CD"]`). */
        categories?: (t: T) => string[] | null | undefined
        /** Read-only items get a subtle badge (e.g. a non-mutating provider action). */
        readOnly?: (t: T) => boolean | null | undefined
        /** Deprecated items get a warning badge and a muted name (e.g. a superseded provider event). */
        deprecated?: (t: T) => boolean | null | undefined
    }
    /** "Choose an event" / "Choose an action". */
    itemsLabel: string
    /** Placeholder for the item search box. @default "Search…" */
    itemsSearchPlaceholder?: string
    emptyItemsText: string
    onPickItem: (connection: C, item: T) => void
    /** Re-run auth for a pending/broken connection (reopens the OAuth popup). When provided, a
     * "Reconnect" affordance shows on the selected connection while it isn't ready. */
    onReconnect?: (connection: C) => void
    /** Whether a reconnect is currently in flight for this connection. */
    isReconnecting?: (connection: C) => boolean
    /** Per-item affordance (tools track selected/pending). Defaults to "add". */
    itemState?: (connection: C, item: T) => CatalogItemState
    /** Connect a not-yet-connected app — render the surface's connect drawer. */
    renderConnect: (
        integration: I,
        handlers: {onClose: () => void; onSuccess: () => void},
    ) => ReactNode
    defaultIntegrationKey?: string
    /** App-tile appearance. "subtle" drops the rest border (agent playground). @default "bordered" */
    cardVariant?: "bordered" | "subtle"
}

function ItemTrailing({state}: {state: CatalogItemState}) {
    if (state === "pending") return <Spin size="small" />
    if (state === "selected")
        return <Check size={13} className="shrink-0 text-[var(--ag-colorPrimary)]" />
    return <Plus size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
}

function CatalogItemList<I, T, C>({
    connection,
    props,
}: {
    connection: C
    props: CatalogChooserProps<I, T, C>
}) {
    const {items, isLoading, hasNextPage, isFetchingNextPage, requestMore, setSearch} =
        props.useItems(props.connection.integrationKey(connection))
    const [query, setQuery] = useState("")
    const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
    // Debounce into the server-side item search; clear the shared atom when leaving this app.
    useEffect(() => {
        const t = setTimeout(() => setSearch(query.trim()), 250)
        return () => clearTimeout(t)
    }, [query, setSearch])
    useEffect(() => () => setSearch(""), [setSearch])

    const describe = props.item.description
    const searching = query.trim().length > 0

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <Input
                allowClear
                placeholder={props.itemsSearchPlaceholder ?? "Search…"}
                prefix={
                    <MagnifyingGlass size={13} className="text-[var(--ag-colorTextTertiary)]" />
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            <div
                ref={setListEl}
                className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1"
            >
                {isLoading && items.length === 0 ? (
                    <div className="flex justify-center py-8">
                        <Spin size="small" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-2 py-4 text-xs text-[var(--ag-colorTextTertiary)]">
                        {searching ? `No matches for “${query.trim()}”.` : props.emptyItemsText}
                    </div>
                ) : (
                    <>
                        {items.map((it) => {
                            const state = props.itemState?.(connection, it) ?? "add"
                            const description = describe?.(it)
                            const categories = (props.item.categories?.(it) ?? []).filter(Boolean)
                            const readOnly = props.item.readOnly?.(it) === true
                            const deprecated = props.item.deprecated?.(it) === true
                            // Deprecated items are visible but not addable — unless one is already
                            // selected, so it stays removable.
                            const isSelected = state === "selected"
                            const disabledRow = deprecated && !isSelected
                            return (
                                <button
                                    key={props.item.key(it)}
                                    type="button"
                                    disabled={disabledRow}
                                    title={
                                        disabledRow
                                            ? "Deprecated — use the recommended event instead"
                                            : undefined
                                    }
                                    onClick={() =>
                                        !disabledRow &&
                                        state !== "pending" &&
                                        props.onPickItem(connection, it)
                                    }
                                    className={`flex w-full items-start gap-3 rounded-md border-0 bg-transparent px-2.5 py-2 text-left ${
                                        disabledRow
                                            ? "cursor-not-allowed opacity-60"
                                            : "cursor-pointer hover:bg-[var(--ag-colorFillSecondary)]"
                                    }`}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            <span
                                                className={`min-w-0 truncate text-[12.5px] font-medium ${
                                                    deprecated
                                                        ? "text-[var(--ag-colorTextTertiary)]"
                                                        : "text-[var(--ag-colorText)]"
                                                }`}
                                            >
                                                {props.item.name(it) || props.item.key(it)}
                                            </span>
                                            {deprecated ? (
                                                <span className="shrink-0 rounded bg-[var(--ag-colorFillSecondary)] px-1 py-px text-[9px] uppercase tracking-wide text-[var(--ag-colorWarningText)]">
                                                    deprecated
                                                </span>
                                            ) : null}
                                            {readOnly ? (
                                                <span className="shrink-0 rounded bg-[var(--ag-colorFillSecondary)] px-1 py-px text-[9px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                                    read-only
                                                </span>
                                            ) : null}
                                        </span>
                                        {description ? (
                                            <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                                {description}
                                            </span>
                                        ) : null}
                                        {categories.length > 0 ? (
                                            <span className="mt-1.5 flex flex-wrap gap-1">
                                                {categories.slice(0, 3).map((c) => (
                                                    <span
                                                        key={c}
                                                        className="ag-drawer-tag rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ag-colorTextTertiary)]"
                                                    >
                                                        {c}
                                                    </span>
                                                ))}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="mt-0.5 shrink-0">
                                        {disabledRow ? null : <ItemTrailing state={state} />}
                                    </span>
                                </button>
                            )
                        })}
                        {isFetchingNextPage && (
                            <div className="flex justify-center py-3">
                                <Spin size="small" />
                            </div>
                        )}
                        <ScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                            root={listEl}
                            rootMargin="0px 0px 600px 0px"
                        />
                    </>
                )}
            </div>
        </div>
    )
}

function ConnectionDetail<I, T, C>({
    connection,
    integration,
    props,
}: {
    connection: C
    integration?: I
    props: CatalogChooserProps<I, T, C>
}) {
    const ready = props.isConnectionReady(connection)
    const account = props.connection.name(connection) || props.connection.slug(connection) || ""
    const connectedAt = props.connection.connectedAt?.(connection) || ""
    return (
        <div className="ag-drawer-card flex items-center gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorder)] px-3 py-2">
            <AppLogo
                logo={integration ? props.integration.logo(integration) : undefined}
                size={20}
            />
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                    {integration
                        ? props.integration.name(integration)
                        : props.connection.integrationKey(connection)}
                </div>
                <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {account || props.connection.integrationKey(connection)}
                    {connectedAt ? ` · connected ${connectedAt}` : ""}
                </div>
            </div>
            <span
                className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${
                    ready ? "text-[var(--ag-colorSuccess)]" : "text-[var(--ag-colorWarningText)]"
                }`}
            >
                <span
                    className={`h-1.5 w-1.5 rounded-full ${
                        ready ? "bg-[var(--ag-colorSuccess)]" : "bg-[var(--ag-colorWarning)]"
                    }`}
                />
                {ready ? "Connected" : "Pending"}
            </span>
        </div>
    )
}

/**
 * Multi-account view: the integration shown once as a header, then one selectable card per
 * connected account. Account cards are labelled by the distinguishing field (the slug the user
 * chose at connect time) because display names default to the integration name and collide.
 */
function ConnectionSwitcher<I, T, C>({
    connections,
    selectedConn,
    integration,
    props,
    onSelect,
}: {
    connections: C[]
    selectedConn: C
    integration?: I
    props: CatalogChooserProps<I, T, C>
    onSelect: (id: string) => void
}) {
    const integrationName = integration
        ? props.integration.name(integration)
        : props.connection.integrationKey(selectedConn)
    const selectedId = props.connection.id(selectedConn)

    return (
        <div className="ag-drawer-card rounded-lg border border-solid border-[var(--ag-colorBorder)] p-2.5">
            <div className="mb-2 flex items-center gap-2.5">
                <AppLogo
                    logo={integration ? props.integration.logo(integration) : undefined}
                    size={20}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {integrationName}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {connections.length} accounts
                </span>
            </div>
            <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                {connections.map((c) => {
                    const id = props.connection.id(c)
                    const name = props.connection.name(c)?.trim()
                    const slug = props.connection.slug(c)?.trim()
                    // Prefer a user-given name; fall back to the slug, which is the per-account
                    // identifier (names default to the integration name and collide).
                    const primary =
                        name && name !== integrationName ? name : slug || name || id || "account"
                    const secondary = primary === slug ? undefined : slug
                    const connectedAt = props.connection.connectedAt?.(c)
                    const ready = props.isConnectionReady(c)
                    const isCurrent = id != null && id === selectedId
                    return (
                        <button
                            key={id ?? primary}
                            type="button"
                            onClick={() => id && onSelect(id)}
                            aria-pressed={isCurrent}
                            className={`flex items-center gap-2 rounded-md border border-solid px-2 py-1.5 text-left ${
                                isCurrent
                                    ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-colorPrimaryBg)]"
                                    : "cursor-pointer border-[var(--ag-colorBorder)] bg-transparent hover:border-[var(--ag-colorPrimary)] hover:bg-[var(--ag-colorFillQuaternary)]"
                            }`}
                        >
                            <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    ready
                                        ? "bg-[var(--ag-colorSuccess)]"
                                        : "bg-[var(--ag-colorWarning)]"
                                }`}
                            />
                            <span className="min-w-0 flex-1">
                                <span
                                    className={`block truncate text-[11px] font-medium ${
                                        isCurrent
                                            ? "text-[var(--ag-colorPrimary)]"
                                            : "text-[var(--ag-colorText)]"
                                    }`}
                                >
                                    {primary}
                                </span>
                                {(secondary || connectedAt) && (
                                    <span className="block truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                                        {secondary}
                                        {secondary && connectedAt ? " · " : ""}
                                        {connectedAt ? `connected ${connectedAt}` : ""}
                                    </span>
                                )}
                            </span>
                            {isCurrent && (
                                <Check
                                    size={12}
                                    className="shrink-0 text-[var(--ag-colorPrimary)]"
                                />
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function AppRailItem({
    active,
    logo,
    name,
    sub,
    state,
    onClick,
}: {
    active: boolean
    logo?: string | null
    name: string
    sub?: string
    /** Connection health dot: green when active, amber when connected-but-pending. */
    state?: "active" | "pending"
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`ag-drawer-row flex w-full cursor-pointer items-center gap-2 rounded border-0 border-l-2 border-solid border-transparent px-2 py-1.5 text-left ${
                active
                    ? "ag-drawer-row-selected bg-[var(--ag-colorPrimaryBg)]"
                    : "bg-transparent hover:bg-[var(--ag-colorFillTertiary)]"
            }`}
        >
            <AppLogo logo={logo} size={18} />
            <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-xs ${
                        active
                            ? "font-medium text-[var(--ag-colorPrimary)]"
                            : "text-[var(--ag-colorText)]"
                    }`}
                >
                    {name}
                </span>
                {sub && (
                    <span className="block truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                        {sub}
                    </span>
                )}
            </span>
            {state && (
                <Tooltip title={state === "active" ? "Active" : "Pending"}>
                    <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            state === "active"
                                ? "bg-[var(--ag-colorSuccess)]"
                                : "bg-[var(--ag-colorWarning)]"
                        }`}
                    />
                </Tooltip>
            )}
        </button>
    )
}

function ConnectInvite<I, T, C>({
    integration,
    props,
    onConnect,
}: {
    integration?: I
    props: CatalogChooserProps<I, T, C>
    onConnect: () => void
}) {
    const name = integration ? props.integration.name(integration) : undefined
    const description = integration ? props.integration.description(integration) : undefined
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <AppLogo
                logo={integration ? props.integration.logo(integration) : undefined}
                size={32}
            />
            <div className="text-xs font-medium">{name ?? "This app"}</div>
            {description && (
                <div className="max-w-[280px] text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                    {description}
                </div>
            )}
            <Button type="primary" onClick={onConnect}>
                Connect {name ?? "app"}
            </Button>
        </div>
    )
}

export function CatalogChooser<I, T, C>(props: CatalogChooserProps<I, T, C>) {
    const {connections, defaultIntegrationKey} = props
    const {integrations, hasNextPage, isFetchingNextPage, isLoading, requestMore, setSearch} =
        props.useIntegrations()

    const byKey = useMemo(() => {
        const m = new Map<string, I>()
        integrations.forEach((i) => m.set(props.integration.key(i), i))
        return m
    }, [integrations, props.integration])
    // Per-integration connection state for the grid dot: "active" if any connection is functional,
    // otherwise "pending" when connections exist but none is ready yet. Ready wins over pending.
    const connStateByKey = useMemo(() => {
        const m = new Map<string, "active" | "pending">()
        connections.forEach((c) => {
            const key = props.connection.integrationKey(c)
            if (props.isConnectionReady(c)) m.set(key, "active")
            else if (!m.has(key)) m.set(key, "pending")
        })
        return m
    }, [connections, props.connection, props.isConnectionReady])

    const [searchInput, setSearchInput] = useState("")
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 250)
        return () => clearTimeout(t)
    }, [searchInput, setSearch])
    // The integrations search is a shared atom — clear it on unmount so a stale query doesn't
    // filter the next open (mirrors the item-search cleanup above).
    useEffect(() => () => setSearch(""), [setSearch])
    const searching = searchInput.trim().length > 0

    const [selected, setSelected] = useState<{kind: "conn" | "intg"; id: string} | null>(
        defaultIntegrationKey ? {kind: "intg", id: defaultIntegrationKey} : null,
    )
    const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null)
    const selectedConn =
        selected?.kind === "conn"
            ? connections.find((c) => props.connection.id(c) === selected.id)
            : selected?.kind === "intg"
              ? connections.find((c) => props.connection.integrationKey(c) === selected.id)
              : undefined
    const selectedIntegration = selectedConn
        ? byKey.get(props.connection.integrationKey(selectedConn))
        : selected?.kind === "intg"
          ? byKey.get(selected.id)
          : undefined
    const [connectIntegration, setConnectIntegration] = useState<I | null>(null)

    // Every account connected to the selected integration — drives the in-detail account switcher
    // so a user with two accounts of the same app can flip between them without leaving the panel.
    const siblingConns = useMemo(
        () =>
            selectedConn
                ? connections.filter(
                      (c) =>
                          props.connection.integrationKey(c) ===
                          props.connection.integrationKey(selectedConn),
                  )
                : [],
        [connections, selectedConn, props.connection],
    )

    const hasConnections = connections.length > 0

    return (
        <div className="flex h-full min-h-[260px] gap-3">
            {hasConnections && (
                <div className="ag-drawer-rail flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto">
                    <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                        Your connections
                    </div>
                    {connections.map((c) => {
                        const app = byKey.get(props.connection.integrationKey(c))
                        const appName = app
                            ? props.integration.name(app)
                            : props.connection.integrationKey(c)
                        // Distinguish two accounts of the same app: prefer a friendly name, fall
                        // back to the connection slug so identical apps don't render as duplicates.
                        const account =
                            props.connection.name(c)?.trim() || props.connection.slug(c)?.trim()
                        return (
                            <AppRailItem
                                key={props.connection.id(c) ?? props.connection.integrationKey(c)}
                                active={
                                    selected?.kind === "conn" &&
                                    selected.id === props.connection.id(c)
                                }
                                logo={app ? props.integration.logo(app) : undefined}
                                name={account || appName}
                                sub={account ? appName : undefined}
                                state={props.isConnectionReady(c) ? "active" : "pending"}
                                onClick={() => {
                                    const id = props.connection.id(c)
                                    if (id) setSelected({kind: "conn", id})
                                }}
                            />
                        )
                    })}
                </div>
            )}

            <div
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                    hasConnections
                        ? "border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3"
                        : ""
                }`}
            >
                {selected ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setSelected(null)}
                            className="mb-3 flex shrink-0 cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                        >
                            <ArrowLeft size={13} /> All apps
                        </button>
                        {selectedConn ? (
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="shrink-0">
                                    {siblingConns.length > 1 ? (
                                        <ConnectionSwitcher
                                            connections={siblingConns}
                                            selectedConn={selectedConn}
                                            integration={selectedIntegration}
                                            props={props}
                                            onSelect={(id) => setSelected({kind: "conn", id})}
                                        />
                                    ) : (
                                        <ConnectionDetail
                                            connection={selectedConn}
                                            integration={selectedIntegration}
                                            props={props}
                                        />
                                    )}
                                    {props.onReconnect &&
                                        !props.isConnectionReady(selectedConn) &&
                                        (() => {
                                            const busy =
                                                props.isReconnecting?.(selectedConn) ?? false
                                            return (
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        props.onReconnect?.(selectedConn)
                                                    }
                                                    className="mt-2 flex w-full items-center justify-between gap-2 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-left disabled:cursor-wait"
                                                >
                                                    <span className="text-[11px] text-[var(--ag-colorWarningText)]">
                                                        Authentication is still pending for this
                                                        connection.
                                                    </span>
                                                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--ag-colorPrimary)]">
                                                        {busy ? (
                                                            <Spin size="small" />
                                                        ) : (
                                                            <ArrowClockwise size={13} />
                                                        )}
                                                        {busy ? "Reconnecting…" : "Reconnect"}
                                                    </span>
                                                </button>
                                            )
                                        })()}
                                    <div className="mb-2 mt-4 flex items-center justify-between gap-2">
                                        <Typography.Text
                                            type="secondary"
                                            className="!text-[10px] uppercase !tracking-wide"
                                        >
                                            {props.itemsLabel}
                                        </Typography.Text>
                                        {selectedIntegration && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setConnectIntegration(selectedIntegration)
                                                }
                                                className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorPrimary)] hover:underline"
                                            >
                                                + Connect another account
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <CatalogItemList
                                    key={props.connection.integrationKey(selectedConn)}
                                    connection={selectedConn}
                                    props={props}
                                />
                            </div>
                        ) : (
                            <ConnectInvite
                                integration={selectedIntegration}
                                props={props}
                                onConnect={() =>
                                    selectedIntegration &&
                                    setConnectIntegration(selectedIntegration)
                                }
                            />
                        )}
                    </div>
                ) : (
                    <>
                        <Input
                            allowClear
                            placeholder="Search apps…"
                            prefix={
                                <MagnifyingGlass
                                    size={13}
                                    className="text-[var(--ag-colorTextTertiary)]"
                                />
                            }
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        <div className="mb-1 mt-2 px-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            {searching ? "Search results" : "All apps"}
                        </div>
                        <div
                            ref={setGridEl}
                            className="grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]"
                        >
                            {integrations.map((i) => (
                                <AppCard
                                    key={props.integration.key(i)}
                                    logo={props.integration.logo(i)}
                                    name={props.integration.name(i)}
                                    description={props.integration.description(i)}
                                    categories={props.integration.categories(i)}
                                    actionsCount={props.integration.actionsCount(i)}
                                    connected={
                                        connStateByKey.get(props.integration.key(i)) === "active"
                                    }
                                    pending={
                                        connStateByKey.get(props.integration.key(i)) === "pending"
                                    }
                                    variant={props.cardVariant}
                                    onClick={() =>
                                        setSelected({kind: "intg", id: props.integration.key(i)})
                                    }
                                />
                            ))}
                            {!isLoading && integrations.length === 0 && (
                                <div className="col-span-full py-6 text-center text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    {searching
                                        ? `No apps match “${searchInput}”.`
                                        : "No apps found."}
                                </div>
                            )}
                            <div className="col-span-full">
                                {(isLoading || isFetchingNextPage) && (
                                    <div className="flex justify-center py-3">
                                        <Spin size="small" />
                                    </div>
                                )}
                                <ScrollSentinel
                                    onVisible={requestMore}
                                    hasMore={hasNextPage}
                                    isFetching={isFetchingNextPage}
                                    root={gridEl}
                                    rootMargin="0px 0px 1600px 0px"
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>

            {connectIntegration &&
                props.renderConnect(connectIntegration, {
                    onClose: () => setConnectIntegration(null),
                    onSuccess: () => setConnectIntegration(null),
                })}
        </div>
    )
}
