/**
 * What one agent may do with one connected MCP server.
 *
 * The drawer itself is the Integrations permission drawer: same preset menu, same two groups, same
 * per-tool select, same rollups. This file is the adapter that feeds it an MCP connection — the
 * header, the tool list, and the three things an MCP server has that a Composio integration does
 * not: a login that can lapse, an include filter that can lock a row, and a place in an agent it
 * can be removed from.
 *
 * The policy belongs to the AGENT, not to the connection: two agents can share one server and be
 * allowed different things, which is why Settings shows the same tools read-only and sends people
 * here. Read-only mode is that Settings view, the spec's "View tools".
 *
 * Nothing here is saved on Done. Every change writes to the agent draft as it is made, so Done and
 * the close X do the same thing.
 */
import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    gatewayRefusalCode,
    gatewayRefusalMessage,
    getMcpConnectionStateLabel,
    isToolHidden,
    listMcpTools,
    setToolPermission,
    toolPermissions,
    type McpConnectionState,
    type McpPermission,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {projectIdAtom} from "@agenta/shared/state"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {ArrowClockwise, Plugs, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    IntegrationPermissionDrawer,
    type PermissionDrawerCatalog,
} from "../DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"
import {PolicyGlyph} from "../DrillInView/SchemaControls/agentTemplate/PermissionGlyph"
import type {PermissionPolicyOption} from "../DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"
import {TOOL_PERMISSION_OPTIONS} from "../DrillInView/SchemaControls/integrationPolicy"
import type {PermissionPolicy} from "../DrillInView/SchemaControls/permissionPolicy"
import type {
    GatewayConnectionPermissions,
    GatewayPermission,
} from "../DrillInView/SchemaControls/toolUtils"

import {
    fromGatewayPermissions,
    inheritOptionLabel,
    toCatalogTools,
    toGatewayPermissions,
    type McpAnnotatedTool,
} from "./mcpPermissionAdapter"

/** A tool the server's include filter hides may not be given a permission at all. */
const HIDDEN_TOOL_REASON = "Hidden by this server's tool filter"

export interface McpPermissionDrawerProps {
    open: boolean
    onClose: () => void
    /** The connection whose tools these are. */
    slug?: string
    /** What that connection is called, for anything a person reads. */
    connectionName?: string
    /** The prefix the model sees on this server's tools, frozen when the server was added. */
    toolPrefix?: string
    /** The connection's health, as the endpoint record derives it. */
    connectionState?: McpConnectionState
    /** The tool count the connection record carries, for the cases where the list cannot be read. */
    cachedToolCount?: number
    /**
     * Where the tool list comes from. Defaults to a live `tools/list` against the connection.
     *
     * A caller that already holds the list, or one rendering the drawer with no gateway behind it,
     * supplies its own. The drawer's four-state machine and its discard-on-switch guard are the
     * same either way.
     */
    loadTools?: (slug: string) => Promise<McpAnnotatedTool[]>
    policy: McpServerPolicy
    onChange: (policy: McpServerPolicy) => void
    /** Renew the login: the OAuth popup, or the key sheet. */
    onReconnect?: () => void
    /** Detach the server from THIS agent. Omitted, the footer link is not offered. */
    onRemove?: () => void
    /** The agent-wide permission policy, for the note under the preset. */
    agentPolicy?: PermissionPolicy | null
    /** Settings' "View tools": the same drawer with nothing to set. */
    readOnly?: boolean
    disabled?: boolean
}

type ToolsState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready"; tools: McpAnnotatedTool[]}
    | {status: "failed"; error: string; needsAuth: boolean}

/**
 * The health words this drawer uses.
 *
 * "Connected" is the word every MCP surface says for a working connection. A lapsed login reads as
 * "Login expired" here rather than the record's own "Needs authorization", because the drawer's
 * banner is about renewing a sign-in that used to work, not about authorizing for the first time.
 */
export function mcpHealthLabel(state: McpConnectionState): string {
    return state === "needs_auth" ? "Login expired" : getMcpConnectionStateLabel(state)
}

/** The login-expired banner (D4), and the one action that fixes it. */
function LoginExpiredBanner({
    connectionName,
    onReconnect,
}: {
    connectionName: string
    onReconnect?: () => void
}) {
    return (
        <div
            role="status"
            className="flex shrink-0 items-center gap-3 rounded-control border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3.5 py-3"
        >
            <WarningCircle size={16} className="shrink-0 text-[var(--ag-colorWarning)]" />
            <p className="m-0 min-w-0 flex-1 text-xs leading-relaxed text-[var(--ag-colorTextSecondary)]">
                <span className="font-medium text-[var(--ag-colorText)]">
                    {connectionName} needs a new sign-in.
                </span>{" "}
                Its tools fail until someone in the project reconnects. Permissions below are kept.
            </p>
            {onReconnect ? (
                <Button variant="default" size="sm" className="shrink-0" onClick={onReconnect}>
                    <ArrowClockwise size={13} data-icon="inline-start" />
                    Reconnect
                </Button>
            ) : null}
        </div>
    )
}

/** Header: the server tile, the name, the frozen tool prefix, and the health. */
function DrawerTitle({
    connectionName,
    toolPrefix,
    state,
    toolCount,
}: {
    connectionName: string
    toolPrefix?: string
    state: McpConnectionState
    toolCount?: number
}) {
    return (
        // w-full + min-w-0: the title slot will not shrink alone, pushing the health past the edge.
        <div className="flex w-full min-w-0 items-center gap-3">
            {/* One generic glyph for every server: an MCP endpoint has no branding to show, and a
                per-server logo would have to be guessed from a URL. Replaced by @agenta/ui's
                IconTile once WP0's primitive lands. */}
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--ag-colorInfoBg)]">
                <Plugs size={14} className="text-[var(--ag-colorInfo)]" />
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-[15px] font-semibold">{connectionName}</span>
                {toolPrefix ? (
                    <span className="shrink-0 font-mono text-xs font-normal text-[var(--ag-colorTextTertiary)]">
                        {toolPrefix}
                    </span>
                ) : null}
                {toolCount != null ? (
                    <span className="shrink-0 text-xs font-normal text-[var(--ag-colorTextTertiary)]">
                        {toolCount} tools
                    </span>
                ) : null}
            </div>
            <StatusIndicator
                tone={state === "ready" ? "success" : "warning"}
                label={mcpHealthLabel(state)}
                className="shrink-0 text-[13px] font-normal"
            />
        </div>
    )
}

/** "Remove from agent", and the confirm that opens directly under it. */
function RemoveFromAgent({
    connectionName,
    onRemove,
    disabled,
}: {
    connectionName: string
    onRemove: () => void
    disabled?: boolean
}) {
    const [confirming, setConfirming] = useState(false)

    return (
        <>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirming(true)}
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-[var(--ag-colorError)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                Remove from agent
            </button>
            {confirming ? (
                <div className="flex flex-col items-start gap-2">
                    <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                        Remove {connectionName} from this agent? The connection stays in the
                        project.
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="destructive" size="sm" onClick={onRemove}>
                            Remove
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : null}
        </>
    )
}

export default function McpPermissionDrawer({
    open,
    onClose,
    slug,
    connectionName,
    toolPrefix,
    connectionState = "ready",
    cachedToolCount,
    loadTools: loadToolsFrom,
    policy,
    onChange,
    onReconnect,
    onRemove,
    agentPolicy,
    readOnly,
    disabled,
}: McpPermissionDrawerProps) {
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const [tools, setTools] = useState<ToolsState>({status: "idle"})
    const name = connectionName || slug || "This server"

    // Which connection the visible list belongs to. A tool list is fetched per connection and
    // arrives whenever it arrives, so without this, switching connections mid-flight rendered the
    // previous one's tools under the new one's name (M4).
    const shownFor = useRef<string | undefined>(undefined)

    const loadTools = useCallback(async () => {
        if (!slug) return
        shownFor.current = slug
        setTools({status: "loading"})
        try {
            const listed = loadToolsFrom
                ? await loadToolsFrom(slug)
                : ((await listMcpTools(slug, projectId)) as McpAnnotatedTool[])
            if (shownFor.current !== slug) return
            setTools({status: "ready", tools: listed})
        } catch (error) {
            if (shownFor.current !== slug) return
            // The gateway's own sentence, with the harness marker taken out of it. What reached the
            // screen before was "Authorization required for custom/<slug>
            // ⟦agenta_code:auth_required⟧", which names a route and a code rather than the
            // connection and what to do about it (QA-D3).
            const needsAuth = gatewayRefusalCode(error) === "auth_required"
            setTools({
                status: "failed",
                needsAuth,
                error: needsAuth
                    ? `${name} is not connected yet, so its tools cannot be listed.`
                    : gatewayRefusalMessage(error) || "The tool list could not be read.",
            })
        }
    }, [loadToolsFrom, name, projectId, slug])

    useEffect(() => {
        if (!open) return
        if (slug) void loadTools()
        else setTools({status: "idle"})
    }, [loadTools, open, slug])

    const permissions = useMemo(() => toGatewayPermissions(policy), [policy])

    const catalogTools = useMemo(
        () => (tools.status === "ready" ? toCatalogTools(tools.tools) : []),
        [tools],
    )

    const loginLapsed = connectionState !== "ready"

    /**
     * Tools that hold a permission the filter now hides.
     *
     * The API refuses the whole policy for these, so an agent carrying one cannot run at all. The
     * row's own control stays disabled — a hidden tool may not be given a permission — so without
     * somewhere to clear it there was no way to repair the agent from here (CR18).
     */
    const strandedByFilter = useMemo(
        () =>
            Object.keys(toolPermissions(policy))
                .filter((toolName) => isToolHidden(policy, toolName))
                .sort(),
        [policy],
    )

    const setTool = useCallback(
        (toolKey: string, permission: GatewayPermission) =>
            onChange(
                setToolPermission(
                    policy,
                    toolKey,
                    // An absent entry IS "inherit" on this wire, so choosing it clears the row.
                    permission === "inherit" ? null : (permission as McpPermission),
                ),
            ),
        [onChange, policy],
    )

    const setPermissions = useCallback(
        (next: GatewayConnectionPermissions) => onChange(fromGatewayPermissions(next, policy)),
        [onChange, policy],
    )

    // The spec's four values, named the way the spec names them. What one ROW shows when it holds
    // no value of its own is decided per row, below.
    const toolOptions = useMemo<PermissionPolicyOption[]>(
        () =>
            TOOL_PERMISSION_OPTIONS.map((option) => ({
                value: option.value,
                title: option.label,
                help: option.help,
                icon: <PolicyGlyph value={option.value} size={14} />,
            })),
        [],
    )

    /**
     * What a row's control shows.
     *
     * A tool with no entry in the table holds NO value on this wire, so its control reads as the
     * fourth value rather than borrowing the server's, and its trigger says what the run will
     * actually do with it. A bare "Allow" on a row nobody set would claim a rule that does not
     * exist, and it would go on claiming it after the server permission changed underneath.
     */
    const rowValue = useCallback(
        (toolKey: string) => {
            const explicit = toolPermissions(policy)[toolKey]
            if (explicit) return {value: explicit as GatewayPermission}
            return {
                value: "inherit" as GatewayPermission,
                triggerTitle: inheritOptionLabel(policy),
            }
        },
        [policy],
    )

    const errorNode = useMemo<ReactNode>(() => {
        if (!slug) {
            return (
                <p className="m-0 px-1 py-4 text-xs text-[var(--ag-colorTextSecondary)]">
                    Select a connection to choose what this agent may do with it.
                </p>
            )
        }
        // The banner above already names the problem and carries Reconnect. A second, differently
        // worded ask for the same sign-in would read as two problems.
        if (loginLapsed) return null
        if (tools.status !== "failed") return null
        return (
            <div className="flex flex-col items-start gap-1 px-1 py-4">
                <p className="m-0 text-xs text-[var(--ag-colorError)]">{tools.error}</p>
                {/* The action that fixes it, where the problem is reported. Retrying a tool list on
                    a server nobody has authorized only fails again. */}
                {tools.needsAuth && onReconnect ? (
                    <Button variant="ghost" size="sm" disabled={disabled} onClick={onReconnect}>
                        Connect
                    </Button>
                ) : (
                    <Button variant="ghost" size="sm" onClick={() => void loadTools()}>
                        Retry tools
                    </Button>
                )}
            </div>
        )
    }, [disabled, loadTools, loginLapsed, onReconnect, slug, tools])

    const catalog = useMemo<PermissionDrawerCatalog>(() => {
        if (!slug) return {status: "error", tools: [], complete: false, errorNode}
        if (tools.status === "loading" || tools.status === "idle") {
            return {status: "loading", tools: [], complete: false}
        }
        if (tools.status === "failed") {
            return {status: "error", tools: [], complete: false, errorNode}
        }
        // A settled list from one request, so a saved key missing from it really has left the
        // server rather than merely not having been fetched yet.
        return {status: "ready", tools: catalogTools, complete: true}
    }, [catalogTools, errorNode, slug, tools.status])

    const footNote =
        strandedByFilter.length && !readOnly ? (
            <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--ag-colorError)]">
                    Rules for tools this server&apos;s filter hides. The agent cannot run until they
                    are removed.
                </span>
                {strandedByFilter.map((toolName) => (
                    <div key={toolName} className="flex items-center justify-between gap-2">
                        <span className="truncate text-field-md">{toolName}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => setTool(toolName, "inherit")}
                        >
                            Remove
                        </Button>
                    </div>
                ))}
            </div>
        ) : null

    return (
        <IntegrationPermissionDrawer
            open={open}
            onClose={onClose}
            // The MCP source supplies its own header and catalog, so neither field reaches a
            // Composio query. They are still required by the shared props.
            target={{provider: "mcp", integration: slug ?? ""}}
            connectionSlug={slug ?? ""}
            permissions={permissions}
            onChangePermissions={setPermissions}
            onChangeToolPermission={setTool}
            agentPolicy={agentPolicy}
            disabled={disabled}
            source={{
                catalogKey: slug ?? "mcp",
                title: (
                    <DrawerTitle
                        connectionName={name}
                        toolPrefix={toolPrefix}
                        state={connectionState}
                        toolCount={
                            readOnly
                                ? catalog.status === "ready"
                                    ? catalogTools.length
                                    : cachedToolCount
                                : undefined
                        }
                    />
                ),
                catalog,
                searchCount: catalog.status === "ready" ? undefined : cachedToolCount,
                emptyLabel: "This server exposes no tools yet.",
                readOnlyLabel: "Read-only",
                writeLabel: "Write",
                toolOptions,
                lockedTool: (toolKey) =>
                    isToolHidden(policy, toolKey) ? HIDDEN_TOOL_REASON : null,
                rowValue,
                banner: loginLapsed ? (
                    <LoginExpiredBanner connectionName={name} onReconnect={onReconnect} />
                ) : null,
                controlsDisabled: loginLapsed,
                footNote,
                footerStart:
                    onRemove && !readOnly ? (
                        <RemoveFromAgent
                            connectionName={name}
                            onRemove={onRemove}
                            disabled={disabled}
                        />
                    ) : null,
                readOnly,
            }}
        />
    )
}
