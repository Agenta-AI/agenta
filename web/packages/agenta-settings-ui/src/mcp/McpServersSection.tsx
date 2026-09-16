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
    getMcpConnectionState,
    mcpEndpointsQueryAtom,
    refreshMcpEndpointsAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {customNamedSecretsAtom} from "@agenta/entities/secret"
import {McpConnectJourney, McpConnectionDetail} from "@agenta/entity-ui/mcpEndpoint"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, IconTile, type DataTableColumn} from "@agenta/ui/ui"
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
 * The two statuses this page can tell apart.
 *
 * The spec draws a third, "Unreachable", for a server whose last health check failed. Nothing
 * on the connection record says that — `flags.is_valid` reports the credential, not the host —
 * so deriving it here would mean labelling every unauthorized row unreachable. Shipped without
 * it per decision 30, and the gap is filed rather than guessed at.
 *
 * Both failure modes collapse to "Login expired": an OAuth grant that was revoked or aged out,
 * and an API key that the server has stopped accepting. They differ in which sheet Reconnect
 * opens, not in what the reader has to do about them (decision 34).
 */
const STATUS = {
    connected: {label: "Connected", tone: "success"} as const,
    expired: {label: "Login expired", tone: "warning"} as const,
}

const isConnected = (endpoint: MCPEndpoint) => getMcpConnectionState(endpoint) === "ready"

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
     * Disconnecting ends the connection: the row leaves the project.
     *
     * The confirm sentence is the spec's and it describes exactly this — agents lose the
     * server's tools, because the server is gone, not because a token was revoked. Per
     * decision 33 there is no second destructive verb on the row; renewing a login is
     * Reconnect, which is a different item.
     */
    const handleDisconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || "this server"
            const run = async () => {
                try {
                    await deleteEndpoint(endpoint.id as string)
                    setViewing(null)
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
        [confirm, deleteEndpoint, setViewing],
    )

    const columns = useMemo<DataTableColumn<MCPEndpoint>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                width: 220,
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
                    const connected = isConnected(record)
                    const status = connected ? STATUS.connected : STATUS.expired
                    return (
                        <span
                            data-testid="mcp-connection-status"
                            className="flex min-w-0 items-center gap-2"
                        >
                            <StatusIndicator
                                tone={status.tone}
                                label={status.label}
                                className="text-[13px]"
                            />
                            {/* The repair is offered where the problem is reported, so a row
                                that needs attention does not send the reader to a menu. */}
                            {!connected && !readOnly ? (
                                <Button
                                    variant="link"
                                    size="xs"
                                    className="h-auto p-0 text-xs"
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
                                      onClick: () => setViewing(record),
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
                                      onClick: () => handleDisconnect(record),
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

            <McpConnectionDetail
                endpoint={viewing}
                onClose={() => setViewing(null)}
                existingNames={names}
                onReconnect={openReconnect}
                // One meaning per word: the drawer's Disconnect ends the connection, exactly as
                // the row menu's does.
                onDisconnect={handleDisconnect}
                onChanged={() => void refresh()}
            />
        </div>
    )
}
