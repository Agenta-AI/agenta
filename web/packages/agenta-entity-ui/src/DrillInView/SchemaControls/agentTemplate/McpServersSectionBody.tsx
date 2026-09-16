/**
 * The agent rail's MCP servers section: the saved rows, and every overlay they lead to.
 *
 * It is a component rather than part of the panel so that the project's connection registry
 * is only fetched where a section renders one. Subscribed from the panel itself it fired on
 * every agent configuration mount, including hosts with no MCP section at all.
 *
 * Every overlay is mounted here, as a SIBLING of the rows and never inside one. React events
 * propagate through the React tree rather than the DOM tree, so a portal is no protection: a
 * dialog mounted in a row reopened that row's drawer on every click inside it, including the
 * click that opened the consent popup, which then surfaced behind it.
 */
import {useCallback, useMemo, useState, type ReactNode} from "react"

import {
    findCustomMcpEndpoint,
    getMcpConnectionStatus,
    hostnameLabel,
    mcpEndpointsQueryAtom,
    readMcpConnectionSlug,
    readMcpPolicy,
    readMcpToolCount,
    refreshMcpEndpointsAtom,
    type MCPEndpoint,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import {
    McpAddServerDrawer,
    McpConnectJourney,
    McpPermissionDrawer,
    type McpConnectionOption,
} from "../../../mcpEndpoint"

import {ConfigItemList} from "./ConfigItemList"
import {type ItemRowStatus} from "./ItemRow"
import {buildMcpAgentItem, mcpItemNeedsRepair, mcpLoginExpired} from "./mcpRail"

export interface McpServersSectionBodyProps {
    /** The agent's saved `mcps` array. */
    items: unknown[]
    disabled?: boolean
    /** Replaces the whole array; the panel owns the agent draft. */
    onChangeItems: (next: unknown[]) => void
    /** Opens the structured form, for a row the permission drawer cannot serve. */
    openForm: (index: number, item: unknown) => void
    removeItem: (index: number) => void
    closeEditor: () => void
    /** The panel's draft and validation markers. Health is layered on top of them here. */
    statusFor: (item: unknown, index: number) => ItemRowStatus | undefined
    emptyAdd: ReactNode
    /** Driven by the section header's add button, which renders outside this body. */
    addOpen: boolean
    onAddClose: () => void
}

export function McpServersSectionBody({
    items,
    disabled,
    onChangeItems,
    openForm,
    removeItem,
    closeEditor,
    statusFor,
    emptyAdd,
    addOpen,
    onAddClose,
}: McpServersSectionBodyProps) {
    // The endpoint being reauthorized. Held here, not on a row, for the reason in the header.
    const [connectingEndpoint, setConnectingEndpoint] = useState<MCPEndpoint | null>(null)
    // Connecting a server that does not exist yet, which is a different journey from repairing
    // one that does: it names and creates the connection rather than reauthorizing it.
    const [connectingNew, setConnectingNew] = useState(false)
    // Which saved item has its permission drawer open, by its index in `mcps` — the same key
    // every other control in this section addresses an item by.
    const [permissionIndex, setPermissionIndex] = useState<number | null>(null)

    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)

    // `custom` only, which is the namespace an agent's connection reference names. A builtin
    // or provider row is not something an agent adds by slug.
    const endpoints = useMemo(
        () =>
            (endpointsQuery.data ?? []).filter(
                (endpoint) => (endpoint.namespace ?? "custom") === "custom",
            ),
        [endpointsQuery.data],
    )

    /** The registered connection one saved item points at, or undefined when it is gone. */
    const endpointForItem = useCallback(
        (item: unknown): MCPEndpoint | undefined => {
            // The slug the item points at, never one re-derived from its name: deriving one is
            // how a renamed item silently repointed at a different connection.
            const slug = readMcpConnectionSlug((item ?? {}) as Record<string, unknown>)
            return slug ? findCustomMcpEndpoint(endpoints, slug) : undefined
        },
        [endpoints],
    )
    const itemExpired = useCallback(
        (item: unknown) => mcpLoginExpired(endpointForItem(item)),
        [endpointForItem],
    )

    const addedSlugs = useMemo(
        () =>
            new Set(
                items
                    .map((item) => readMcpConnectionSlug(item as Record<string, unknown>))
                    .filter((slug): slug is string => Boolean(slug)),
            ),
        [items],
    )
    const options = useMemo<McpConnectionOption[]>(
        () =>
            endpoints
                .filter((endpoint): endpoint is MCPEndpoint & {slug: string} =>
                    Boolean(endpoint.slug),
                )
                .map((endpoint) => ({
                    slug: endpoint.slug,
                    name: endpoint.name || endpoint.slug,
                    host: hostnameLabel(endpoint.data.route.base_url ?? ""),
                    status: getMcpConnectionStatus(endpoint),
                    // Null on every row today, and read off the record rather than fetched:
                    // a count per row would cost one handshake per server on open.
                    toolCount: readMcpToolCount(endpoint),
                    added: addedSlugs.has(endpoint.slug),
                }))
                // Sorted by name, and an added row keeps its place rather than sorting to the
                // end: the reader is looking a server up, not working through a queue.
                .sort((a, b) => a.name.localeCompare(b.name)),
        [endpoints, addedSlugs],
    )

    /** Attach one connection to this agent and open its permissions. */
    const addConnection = useCallback(
        (option: {slug: string; name: string}) => {
            onChangeItems([...items, buildMcpAgentItem(option)])
            onAddClose()
            setPermissionIndex(items.length)
        },
        [items, onChangeItems, onAddClose],
    )

    const statusForRow = useCallback(
        (item: unknown, index: number): ItemRowStatus | undefined => {
            const base = statusFor(item, index)
            // A blocking problem outranks a draft marker and structural invalid stays first,
            // the same order the tool rows use. No label: the row states the expiry in its own
            // body, and a tag saying it again reads as two separate problems.
            if (base?.tone === "invalid") return base
            if (itemExpired(item)) return {tone: "incomplete"}
            return base
        },
        [statusFor, itemExpired],
    )
    // Only an unhealthy connection surfaces a state. A row that reads "Connected" on every
    // server teaches the reader to skip the column.
    const extraForRow = useCallback(
        (item: unknown) =>
            itemExpired(item) ? (
                <StatusIndicator tone="warning" label="Login expired" className="text-xs" />
            ) : undefined,
        [itemExpired],
    )
    /** Where a row goes when it is clicked; see {@link mcpItemNeedsRepair}. */
    const openRow = useCallback(
        (_kind: "mcp" | "tool" | "skill", index: number, item: unknown) => {
            const record = (item ?? {}) as Record<string, unknown>
            if (mcpItemNeedsRepair(record, endpointForItem(item))) {
                openForm(index, item)
                return
            }
            setPermissionIndex(index)
        },
        [endpointForItem, openForm],
    )

    // Read live from the list rather than captured when the drawer opened: an item removed
    // from under it has to close the drawer, not leave it editing a policy nobody holds.
    const permissionItem = useMemo(() => {
        if (permissionIndex == null) return null
        const item = items[permissionIndex]
        return item && typeof item === "object" ? (item as Record<string, unknown>) : null
    }, [permissionIndex, items])
    const permissionEndpoint = useMemo(
        () => (permissionItem ? endpointForItem(permissionItem) : undefined),
        [permissionItem, endpointForItem],
    )

    return (
        <>
            <ConfigItemList
                kind="mcp"
                items={items}
                openEdit={openRow}
                removeItem={(_kind, index) => removeItem(index)}
                closeEditor={closeEditor}
                disabled={disabled}
                statusFor={statusForRow}
                extraFor={extraForRow}
                emptyAdd={emptyAdd}
            />

            <McpAddServerDrawer
                open={addOpen}
                onClose={onAddClose}
                options={options}
                loading={endpointsQuery.isPending}
                onConnectServer={() => setConnectingNew(true)}
                onAdd={addConnection}
                onReconnect={({slug}) => {
                    const endpoint = findCustomMcpEndpoint(endpoints, slug)
                    if (endpoint) setConnectingEndpoint(endpoint)
                }}
            />

            {permissionItem ? (
                <McpPermissionDrawer
                    open
                    onClose={() => setPermissionIndex(null)}
                    slug={readMcpConnectionSlug(permissionItem) ?? undefined}
                    connectionName={permissionEndpoint?.name || undefined}
                    toolPrefix={
                        typeof permissionItem.name === "string" ? permissionItem.name : undefined
                    }
                    policy={readMcpPolicy(permissionItem)}
                    onChange={(policy: McpServerPolicy) =>
                        onChangeItems(
                            items.map((item, index) =>
                                index === permissionIndex
                                    ? {...(item as Record<string, unknown>), policy}
                                    : item,
                            ),
                        )
                    }
                    onRemove={() => {
                        removeItem(permissionIndex!)
                        setPermissionIndex(null)
                    }}
                    onReconnect={
                        permissionEndpoint
                            ? () => setConnectingEndpoint(permissionEndpoint)
                            : undefined
                    }
                    status={
                        permissionEndpoint ? getMcpConnectionStatus(permissionEndpoint) : undefined
                    }
                    cachedToolCount={
                        permissionEndpoint ? readMcpToolCount(permissionEndpoint) : null
                    }
                    disabled={disabled}
                />
            ) : null}

            {connectingNew ? (
                <McpConnectJourney
                    open
                    onClose={() => setConnectingNew(false)}
                    existingNames={endpoints.map((endpoint) => endpoint.name)}
                    // The new connection joins this agent and its permissions open, so
                    // connecting a server and configuring it is one errand, not two.
                    onConnected={({slug, name}) => {
                        setConnectingNew(false)
                        addConnection({slug, name})
                    }}
                />
            ) : null}

            {connectingEndpoint?.id && connectingEndpoint.slug ? (
                <McpConnectJourney
                    open
                    onClose={() => setConnectingEndpoint(null)}
                    reconnect={{
                        id: connectingEndpoint.id,
                        slug: connectingEndpoint.slug,
                        name: connectingEndpoint.name || connectingEndpoint.slug,
                        url: connectingEndpoint.data.route.base_url || "",
                        authMode: connectingEndpoint.auth_mode,
                    }}
                    onConnected={() => void refreshEndpoints()}
                />
            ) : null}
        </>
    )
}
