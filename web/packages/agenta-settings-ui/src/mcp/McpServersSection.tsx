/**
 * The project's MCP connections, as one settings section both hosts mount.
 *
 * It lives here rather than in `web/oss` so the desktop and the mobile app render the same
 * surface from the same code. That is the whole reason the integrations section next door
 * takes a copy override, and this follows it.
 *
 * The list shows stored connections only. Provider-managed rows belong with the
 * integrations they come from, not under a heading about MCP servers.
 *
 * This page is the registry and nothing else: it says which servers the project has and how
 * each one authenticates. What a server may actually do is a property of an agent, not of the
 * connection, so permissions are reachable from here only read-only ("View tools").
 */
import {useCallback, useMemo, useState} from "react"

import {
    deleteMcpEndpointAtom,
    disconnectMcpEndpointAtom,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
    mcpEndpointsQueryAtom,
    readMcpToolCount,
    refreshMcpEndpointsAtom,
    type McpConnectionStatus,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {
    McpConnectJourney,
    McpConnectionDetail,
    McpPermissionDrawer,
} from "@agenta/entity-ui/mcpEndpoint"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    Button,
    cn,
    DataTable,
    EmptyState,
    IconTile,
    touchTargetExpansion,
    type DataTableColumn,
} from "@agenta/ui/ui"
import {Plugs, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"

/** Nouns for the rows; a host that calls them something else passes its own. */
export interface McpServersSectionCopy {
    connect: string
    emptyTitle: string
    emptyBody: string
}

const DEFAULT_COPY: McpServersSectionCopy = {
    connect: "Connect MCP",
    emptyTitle: "No MCP servers connected",
    emptyBody:
        "Connect a server by URL. You'll sign in or add a key once; agents in this project can then add it and choose what it may run.",
}

/**
 * How a row's status colours its dot. The words and the derivation are the entity layer's, so
 * this page and the permission drawer cannot drift into two names for one state.
 *
 * "Unreachable" is in the vocabulary and never rendered today: nothing on the connection record
 * reports whether the host answered (issue #6907). `getMcpConnectionStatus` carries the seam and
 * the tone is declared here so the row is right the day the field arrives.
 */
const STATUS_TONE: Record<McpConnectionStatus, "success" | "warning" | "error"> = {
    connected: "success",
    login_expired: "warning",
    unreachable: "error",
}

/**
 * Whether there is a stored grant this row could give back.
 *
 * Only an OAuth connection: the revoke route refuses anything else outright with "endpoint is
 * not a custom OAuth target" (`gateways/mcps/router.py`), so offering the action on a key row
 * would produce a 400 on a row that reads as connected. A grant the server has stopped honouring
 * still counts — the handle is dropped whether or not the far side still knows about it, which
 * is the state that made a connection report itself ready and then fail every call.
 */
const hasGrantToRevoke = (endpoint: MCPEndpoint) =>
    endpoint.auth_mode === "oauth" && Boolean(endpoint.secret_id)

export interface McpServersSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides every write affordance. */
    readOnly?: boolean
    copy?: Partial<McpServersSectionCopy>
}

export default function McpServersSection({
    confirm,
    readOnly,
    copy: copyOverrides,
}: McpServersSectionProps) {
    const copy = useMemo<McpServersSectionCopy>(
        () => ({...DEFAULT_COPY, ...copyOverrides}),
        [copyOverrides],
    )

    const {data: endpoints, isPending} = useAtomValue(mcpEndpointsQueryAtom)
    const refresh = useSetAtom(refreshMcpEndpointsAtom)
    const disconnect = useSetAtom(disconnectMcpEndpointAtom)
    const deleteEndpoint = useSetAtom(deleteMcpEndpointAtom)
    const namedSecrets = useAtomValue(customNamedSecretsAtom)

    const [connecting, setConnecting] = useState(false)
    const [reconnecting, setReconnecting] = useState<MCPEndpoint | null>(null)
    /**
     * Which connection is open, by identity rather than by value.
     *
     * Holding the row itself froze it at the moment it was clicked, so a disconnect updated
     * the list underneath while the open connection went on reporting Ready and offering to
     * disconnect again (QA-D2). The row is looked up fresh on every render instead.
     */
    const [viewingKey, setViewingKey] = useState<string | null>(null)
    /** "View tools", tracked by key for the same reason as the connection above. */
    const [toolsKey, setToolsKey] = useState<string | null>(null)

    const rows = useMemo(() => endpoints ?? [], [endpoints])
    const names = useMemo(() => rows.map((row) => row.name), [rows])
    const rowKey = useCallback((record: MCPEndpoint) => record.id ?? record.slug ?? "", [])
    const viewing = useMemo(
        () => rows.find((row) => rowKey(row) === viewingKey) ?? null,
        [rowKey, rows, viewingKey],
    )
    const setViewing = useCallback(
        (record: MCPEndpoint | null) => setViewingKey(record ? rowKey(record) : null),
        [rowKey],
    )
    const viewingTools = useMemo(
        () => rows.find((row) => rowKey(row) === toolsKey) ?? null,
        [rowKey, rows, toolsKey],
    )

    /**
     * The name the project filed a credential under, for the Auth cell.
     *
     * The endpoint stores `secret_id`; the label has to be the name the person chose in the
     * connect sheet, which lives on the vault row. A secret that no longer resolves falls back
     * to the bare kind rather than printing an id — this cell never shows a value, and an id
     * is closer to a value than to a name.
     */
    const secretNameById = useMemo(() => {
        const byId = new Map<string, string>()
        for (const secret of namedSecrets) {
            if (secret.id) byId.set(secret.id, secret.name || secret.slug || "")
        }
        return byId
    }, [namedSecrets])

    const openConnect = useCallback(() => {
        setReconnecting(null)
        setConnecting(true)
    }, [])

    const openReconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            setViewing(null)
            setReconnecting(endpoint)
            setConnecting(true)
        },
        [setViewing],
    )

    const closeConnect = useCallback(() => {
        setConnecting(false)
        setReconnecting(null)
    }, [])

    /**
     * Disconnecting gives back the login. The connection stays.
     *
     * The row remains, reporting Login expired, and Reconnect renews it — which is why the two
     * are separate items rather than one. The confirm sentence is the spec's: agents lose the
     * server's tools because its calls start failing, not because the server went away.
     */
    const handleDisconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || "this server"
            const run = async () => {
                try {
                    await disconnect(endpoint.id as string)
                } catch (error) {
                    message.error(
                        (error as Error)?.message || "Failed to disconnect the MCP server.",
                    )
                }
            }
            if (!confirm) return void run()
            confirm({
                title: `Disconnect ${label}`,
                message: "Agents using this server lose its tools",
                okText: "Disconnect",
                danger: true,
                onOk: run,
            })
        },
        [confirm, disconnect],
    )

    /**
     * Removing takes the identity with it, which disconnecting does not.
     *
     * The spec draws no deletion at all, and a spec that does not draw an action does not
     * remove it: without this there is no way to take a server out of a project.
     */
    const handleRemove = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || "this server"
            const run = async () => {
                try {
                    await deleteEndpoint(endpoint.id as string)
                    setViewing(null)
                    setToolsKey(null)
                } catch (error) {
                    message.error((error as Error)?.message || "Failed to remove the MCP server.")
                }
            }
            if (!confirm) return void run()
            confirm({
                title: "Remove server",
                message: `${label} is removed from this project. Agents configured to use it stop working, and reconnecting later creates a new connection.`,
                onOk: run,
            })
        },
        [confirm, deleteEndpoint, setViewing],
    )

    const columns = useMemo<DataTableColumn<MCPEndpoint>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                width: 220,
                // Flexible, unlike the usual first column: on a phone it and Status are the only
                // two left, and a pinned 220 there would push the table into a sideways scroll.
                flexible: true,
                render: (record) => (
                    <span className="flex min-w-0 items-center gap-2.5">
                        {/* One generic glyph for every server: the registry holds arbitrary
                            URLs, so there is no per-server branding to show (decision 3). */}
                        <IconTile size={24} tone="info" aria-hidden="true">
                            <Plugs />
                        </IconTile>
                        <span data-testid="mcp-connection-name" className="truncate font-medium">
                            {record.name || record.slug}
                        </span>
                    </span>
                ),
            },
            {
                key: "url",
                title: "Server URL",
                width: 320,
                flexible: true,
                // The details are a wider screen's: below `md` the row keeps what identifies it
                // and what acts on it, and the URL is one tap away in the connection itself.
                // Without this the registry was a 986px table scrolling sideways inside a 348px
                // phone, which the plan's acceptance rules out.
                responsive: "md",
                mono: true,
                render: (record) => (
                    <span
                        className="block truncate text-colorTextDescription"
                        title={record.data.route.base_url ?? undefined}
                    >
                        {record.data.route.base_url}
                    </span>
                ),
            },
            {
                key: "auth",
                title: "Auth",
                width: 200,
                // The last column to earn its place: even at `lg` the other three plus the
                // actions gutter fill the page.
                responsive: "xl",
                render: (record) => {
                    if (record.auth_mode === "oauth") return "OAuth"
                    if (record.auth_mode === "none") return "None"
                    const secretName = record.secret_id
                        ? secretNameById.get(record.secret_id)
                        : undefined
                    // Never the credential itself, only what it is filed under.
                    return secretName ? (
                        <span className="flex min-w-0 items-center gap-1">
                            <span>API key ·</span>
                            <span className="truncate font-mono text-xs">{secretName}</span>
                        </span>
                    ) : (
                        "API key"
                    )
                },
            },
            {
                key: "status",
                title: "Status",
                width: 190,
                render: (record) => {
                    const status = getMcpConnectionStatus(record)
                    const connected = status === "connected"
                    return (
                        <span
                            data-testid="mcp-connection-status"
                            className="flex min-w-0 items-center gap-2"
                        >
                            <StatusIndicator
                                tone={STATUS_TONE[status]}
                                label={getMcpConnectionStatusLabel(status)}
                                // min-w-0 lets the indicator's own truncation act. Without it its
                                // automatic minimum is its text, so at phone width the cell's
                                // content overran the column and slid the Reconnect link under the
                                // next cell's row menu, which covered 43 of its 70px.
                                className="min-w-0 text-[13px]"
                            />
                            {/* The repair is offered where the problem is reported, so a row
                                that needs attention does not send the reader to a menu. */}
                            {!connected && !readOnly ? (
                                <Button
                                    variant="link"
                                    size="xs"
                                    // No `h-auto`: the size's own height is the app's control
                                    // scale, and overriding it left a 20px tap target on a phone.
                                    // The scale's 24px is still under the 44px touch minimum, so
                                    // the invisible expansion carries the rest. The Button's own
                                    // base classes keep it from shrinking, so the status text
                                    // beside it is what gives way.
                                    className={cn("p-0 text-xs", touchTargetExpansion(24))}
                                    onClick={(event) => {
                                        // The row opens the connection on click; this is a
                                        // different intent and must not also do that.
                                        event.stopPropagation()
                                        openReconnect(record)
                                    }}
                                >
                                    Reconnect
                                </Button>
                            ) : null}
                        </span>
                    )
                },
            },
        ],
        [openReconnect, readOnly, secretNameById],
    )

    return (
        <div className="flex flex-col gap-3">
            {/* E2 drops the header button in favour of the one in the empty state, so there is
                never a screen offering the same action twice. */}
            {readOnly || (!isPending && rows.length === 0) ? null : (
                <div className="flex justify-end">
                    <Button data-testid="mcp-connect-open" onClick={openConnect}>
                        <Plus size={14} />
                        {copy.connect}
                    </Button>
                </div>
            )}

            {!isPending && rows.length === 0 ? (
                <EmptyState
                    className="rounded-lg border border-dashed border-colorBorder px-6 py-12"
                    image={
                        <IconTile size={44} tone="muted" aria-hidden="true">
                            <Plugs />
                        </IconTile>
                    }
                    description={copy.emptyBody}
                    title={copy.emptyTitle}
                >
                    {readOnly ? null : (
                        <Button data-testid="mcp-connect-open" onClick={openConnect}>
                            {copy.connect}
                        </Button>
                    )}
                </EmptyState>
            ) : (
                <DataTable<MCPEndpoint>
                    columns={columns}
                    rows={rows}
                    loading={isPending}
                    skeletonRows={3}
                    rowKey={rowKey}
                    onRowClick={(record) => setViewing(record)}
                    actions={
                        readOnly
                            ? undefined
                            : (record) => [
                                  {
                                      key: "reconnect",
                                      label: "Reconnect",
                                      onClick: () => openReconnect(record),
                                  },
                                  {
                                      key: "view-tools",
                                      label: "View tools",
                                      onClick: () => setToolsKey(rowKey(record)),
                                  },
                                  {
                                      key: "rename",
                                      label: "Rename",
                                      onClick: () => setViewing(record),
                                  },
                                  {type: "divider"},
                                  {
                                      key: "disconnect",
                                      label: "Disconnect",
                                      danger: true,
                                      // Hidden where there is no grant to give back, which
                                      // would be a 400 on a row that reads as connected.
                                      hidden: !hasGrantToRevoke(record),
                                      onClick: () => handleDisconnect(record),
                                  },
                                  {
                                      key: "remove",
                                      label: "Remove",
                                      danger: true,
                                      onClick: () => handleRemove(record),
                                  },
                              ]
                    }
                />
            )}

            <McpConnectJourney
                // A new controller per attempt. The component unmounts itself while closed,
                // which covers open/close; the key covers the other way in, where a reconnect
                // is chosen while one is already open and the hook would otherwise keep the
                // endpoint it was mounted with.
                key={reconnecting?.id ?? "new"}
                open={connecting}
                onClose={closeConnect}
                existingNames={names}
                reconnect={
                    reconnecting?.id && reconnecting.slug
                        ? {
                              id: reconnecting.id,
                              slug: reconnecting.slug,
                              name: reconnecting.name || reconnecting.slug,
                              url: reconnecting.data.route.base_url || "",
                              authMode: reconnecting.auth_mode,
                          }
                        : null
                }
                onConnected={() => void refresh()}
            />

            {/*
                "View tools" is the agent's permission drawer with nothing to set: the header,
                the groups and the rows, no selects and no footer (decision 23). A Settings row
                belongs to no agent, so there is no policy to read or write here — the empty
                policy and the ignored `onChange` say that, and `readOnly` makes it true rather
                than merely unused.
            */}
            <McpPermissionDrawer
                open={Boolean(viewingTools)}
                onClose={() => setToolsKey(null)}
                slug={viewingTools?.slug ?? undefined}
                connectionName={viewingTools?.name || viewingTools?.slug || undefined}
                // Passed rather than defaulted: the drawer assumes "connected" when given
                // nothing, which would claim a healthy server for a lapsed one.
                status={viewingTools ? getMcpConnectionStatus(viewingTools) : undefined}
                // Null for every row until the query response carries a count, so the header
                // shows none. Wired now so it starts working with no change here.
                cachedToolCount={
                    viewingTools ? (readMcpToolCount(viewingTools) ?? undefined) : undefined
                }
                policy={{}}
                onChange={() => undefined}
                onReconnect={viewingTools ? () => openReconnect(viewingTools) : undefined}
                readOnly
            />

            <McpConnectionDetail
                endpoint={viewing}
                onClose={() => setViewing(null)}
                existingNames={names}
                onReconnect={openReconnect}
                onDisconnect={handleDisconnect}
                onChanged={() => void refresh()}
            />
        </div>
    )
}
