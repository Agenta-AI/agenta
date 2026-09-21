/**
 * What one agent may do with one connected MCP server.
 *
 * The drawer itself is the Integrations permission drawer: same preset menu, same two groups, same
 * per-tool select. This file is the adapter that feeds it an MCP connection — the header, the tool
 * list, and the three things an MCP server has that a Composio integration does not: a login that
 * can lapse, an include filter that can lock a row, and a place in an agent it can be removed from.
 *
 * The translation between the two saved shapes is not here. It is `toGatewayPermissions` and
 * `fromGatewayPermissions` in `@agenta/entities`, where `inherit` is modelled as the absence of a
 * value and `default` means "what a tool with no entry of its own gets". This file calls them and
 * resolves nothing itself; the runner is still the only place an effective permission is computed.
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
    askWritesPolicy,
    fromGatewayPermissions,
    gatewayRefusalCode,
    gatewayRefusalMessage,
    getMcpConnectionStatusLabel,
    isToolHidden,
    listMcpTools,
    toCatalogTools,
    toGatewayPermissions,
    toolPermissions,
    type McpConnectionStatus,
    type McpServerPolicy,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"
import {projectIdAtom} from "@agenta/shared/state"
import {formatCount} from "@agenta/shared/utils"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Alert, Button, IconTile, InlineConfirm} from "@agenta/ui/ui"
import {ArrowClockwise, Plugs} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    IntegrationPermissionDrawer,
    type PermissionDrawerCatalog,
    type PermissionPresetSource,
} from "../DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"
import {PolicyGlyph} from "../DrillInView/SchemaControls/agentTemplate/PermissionGlyph"
import type {PermissionPolicyOption} from "../DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"
import {
    TOOL_PERMISSION_OPTIONS,
    type PermissionPresetValue,
} from "../DrillInView/SchemaControls/integrationPolicy"
import type {PermissionPolicy} from "../DrillInView/SchemaControls/permissionPolicy"
import type {
    GatewayConnectionPermissions,
    GatewayPermission,
} from "../DrillInView/SchemaControls/toolUtils"

import {FOLLOW_AGENT_PRESET, MCP_PRESETS, PRESET_PERMISSION, readMcpPreset} from "./mcpPresets"

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
    /**
     * The connection's health, in the list surfaces' own vocabulary.
     *
     * A caller holding an endpoint record passes `getMcpConnectionStatus(endpoint)`. That is one
     * word per state across the registry table, the agent rail and this drawer, and it is why a
     * key-authenticated connection whose credential stopped working reads "Login expired" here
     * rather than "Needs input" (decision 34).
     */
    status?: McpConnectionStatus
    /**
     * The tool count the connection record carries, for the cases where the list cannot be read.
     *
     * Null as well as undefined, because `readMcpToolCount` returns null for a record with no
     * cached count and every caller passes it straight through.
     */
    cachedToolCount?: number | null
    /**
     * Where the tool list comes from. Defaults to a live `tools/list` against the connection.
     *
     * A caller that already holds the list, or one rendering the drawer with no gateway behind it,
     * supplies its own. The drawer's four-state machine and its discard-on-switch guard are the
     * same either way.
     */
    loadTools?: (slug: string) => Promise<McpToolSummary[]>
    policy: McpServerPolicy
    onChange: (policy: McpServerPolicy) => void
    /** Renew the login: the OAuth popup, or the key sheet. */
    onReconnect?: () => void
    /** Detach the server from THIS agent. Omitted, the footer link is not offered. */
    onRemove?: () => void
    /**
     * The agent-wide `runner.permissions.default`, for the note under the preset.
     *
     * It is the whole meaning of the "Follow agent policy" preset, so the drawer names it there
     * rather than sending a reader to a different row to find out whether the ladder asks, allows
     * or denies. A caller with no agent in hand (Settings' read-only "View tools") passes none,
     * and that view has no preset select to qualify anyway.
     */
    agentPolicy?: PermissionPolicy | null
    /** Settings' "View tools": the same drawer with nothing to set. */
    readOnly?: boolean
    disabled?: boolean
}

type ToolsState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready"; tools: McpToolSummary[]}
    | {status: "failed"; error: string; needsAuth: boolean}

/** The login-expired banner (D4), and the one action that fixes it. */
function LoginExpiredBanner({
    connectionName,
    onReconnect,
}: {
    connectionName: string
    onReconnect?: () => void
}) {
    return (
        <Alert
            type="warning"
            showIcon
            className="shrink-0 border-colorWarningBorder bg-colorWarningBg"
            // `mcpServerNoticeCopy` in @agenta/chat carries these two sentences for the
            // transcript, minus the third: entity-ui cannot import chat, so the copy is shared by
            // convention. Change one and change the other. It drops "Permissions below are kept"
            // on purpose, because that points at controls a transcript does not have.
            message={`${connectionName} needs a new sign-in.`}
            description="Its tools fail until someone in the project reconnects. Permissions below are kept."
            action={
                onReconnect ? (
                    <Button variant="default" size="sm" onClick={onReconnect}>
                        <ArrowClockwise data-icon="inline-start" />
                        Reconnect
                    </Button>
                ) : undefined
            }
        />
    )
}

/** Header: the server tile, the name, the frozen tool prefix, and the health. */
function DrawerTitle({
    connectionName,
    toolPrefix,
    status,
    toolCount,
}: {
    connectionName: string
    toolPrefix?: string
    status: McpConnectionStatus
    toolCount?: number
}) {
    return (
        // w-full + min-w-0: the title slot will not shrink alone, pushing the health past the edge.
        <div className="flex w-full min-w-0 items-center gap-3">
            {/* One generic glyph for every server: an MCP endpoint has no branding to show, and a
                per-server logo would have to be guessed from a URL (decision 3). */}
            <IconTile size={24}>
                <Plugs />
            </IconTile>
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-[15px] font-semibold">{connectionName}</span>
                {toolPrefix ? (
                    <span className="shrink-0 font-mono text-xs font-normal text-colorTextTertiary">
                        {toolPrefix}
                    </span>
                ) : null}
                {toolCount != null ? (
                    <span className="shrink-0 text-xs font-normal text-colorTextTertiary">
                        {formatCount(toolCount, "tool")}
                    </span>
                ) : null}
            </div>
            <StatusIndicator
                tone={status === "connected" ? "success" : "warning"}
                label={getMcpConnectionStatusLabel(status)}
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

    if (confirming) {
        return (
            <InlineConfirm
                message={`Remove ${connectionName} from this agent? The connection stays in the project.`}
                confirmLabel="Remove"
                onConfirm={onRemove}
                onCancel={() => setConfirming(false)}
            />
        )
    }

    return (
        // The kit's button rather than a bare styled one: it is the only thing here that carries
        // the app's focus ring, and this is the destructive control.
        <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="px-0 text-[13px] font-normal text-colorError hover:bg-transparent hover:opacity-80"
        >
            Remove from agent
        </Button>
    )
}

export default function McpPermissionDrawer({
    open,
    onClose,
    slug,
    connectionName,
    toolPrefix,
    status = "connected",
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
                : await listMcpTools(slug, projectId)
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

    const loginLapsed = status !== "connected"

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

    // Both write paths go through the one adapter, so a preset pick and a per-tool change cannot
    // disagree about which slot holds the default.
    const write = useCallback(
        (next: GatewayConnectionPermissions) => onChange(fromGatewayPermissions(next, policy)),
        [onChange, policy],
    )

    const setTool = useCallback(
        (toolKey: string, permission: GatewayPermission) => {
            const nextTools = {...permissions.tools}
            // An absent entry IS "inherit" on this wire, so choosing it clears the row.
            if (permission === "inherit") delete nextTools[toolKey]
            else nextTools[toolKey] = permission
            write({...permissions, tools: nextTools})
        },
        [permissions, write],
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
     * fourth value rather than borrowing the one that governs it, and its trigger says what the run
     * will actually do. A bare "Allow" on a row nobody set would claim a rule that does not exist,
     * and it would go on claiming it after the governing value changed underneath.
     */
    const rowValue = useCallback(
        (toolKey: string) => {
            const explicit = permissions.tools[toolKey]
            if (explicit) return {value: explicit}
            return {
                value: "inherit" as GatewayPermission,
                // Nothing governs it either, so there is no provenance to add and the row says
                // which value it holds.
                triggerTitle:
                    permissions.default === "inherit"
                        ? undefined
                        : `Inherits ${permissions.default}`,
            }
        },
        [permissions],
    )

    /**
     * The read-only tools the server advertises, by the name a policy entry is keyed by.
     *
     * Null until the list has been read, which is the difference between "this server has no
     * read-only tools" and "nobody has asked yet". The "Ask for write and delete" preset names
     * these tools one by one, so without them it would write the absent shape under a help line
     * promising the opposite.
     */
    const readOnlyToolNames = useMemo(
        () =>
            tools.status === "ready"
                ? catalogTools.filter((tool) => tool.readOnly === true).map((tool) => tool.key)
                : null,
        [catalogTools, tools.status],
    )

    // Still on its way, as opposed to settled with no list: a failed read is not coming back, and a
    // control that waits forever is its own kind of untruth.
    const toolsArriving = tools.status === "loading" || tools.status === "idle"

    const {preset, overrideCount} = useMemo(
        () => readMcpPreset(policy, {names: readOnlyToolNames, arriving: toolsArriving}),
        [policy, readOnlyToolNames, toolsArriving],
    )

    const presets = useMemo<PermissionPresetSource>(
        () => ({
            options: MCP_PRESETS.map((option) =>
                // Disabled, beside the list's own loading rows, until the tool list arrives: this
                // is the one preset that writes tool names, and writing it without them would save
                // the absent policy under a help line promising the opposite.
                option.value === "ask_writes" && readOnlyToolNames === null
                    ? {...option, disabled: true}
                    : option,
            ),
            // Null is "not knowable until the list lands", which `pending` draws instead.
            agentPolicyPreset: FOLLOW_AGENT_PRESET,
            value: preset ?? "custom",
            overrideCount,
            pending: preset === null,
            onPick: (picked: PermissionPresetValue) => {
                if (picked === "ask_writes") {
                    onChange(askWritesPolicy(readOnlyToolNames ?? [], policy))
                    return
                }
                const value = PRESET_PERMISSION[picked]
                // Custom is not pickable; nothing else has no value.
                if (value) write({default: value, tools: {}})
            },
        }),
        [onChange, overrideCount, policy, preset, readOnlyToolNames, write],
    )

    const errorNode = useMemo<ReactNode>(() => {
        if (!slug) {
            return (
                <p className="m-0 px-1 py-4 text-xs text-colorTextSecondary">
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
                <p className="m-0 text-xs text-colorError">{tools.error}</p>
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
                <span className="text-xs text-colorError">
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
            onChangePermissions={write}
            onChangeToolPermission={setTool}
            agentPolicy={agentPolicy}
            disabled={disabled}
            source={{
                catalogKey: slug ?? "mcp",
                title: (
                    <DrawerTitle
                        connectionName={name}
                        toolPrefix={toolPrefix}
                        status={status}
                        toolCount={
                            readOnly
                                ? catalog.status === "ready"
                                    ? catalogTools.length
                                    : (cachedToolCount ?? undefined)
                                : undefined
                        }
                    />
                ),
                catalog,
                searchCount:
                    catalog.status === "ready" ? undefined : (cachedToolCount ?? undefined),
                emptyLabel: "This server exposes no tools yet.",
                readOnlyLabel: "Read-only",
                writeLabel: "Write",
                // The spec's own phrase for a saved rule whose tool the server has stopped
                // advertising. "Not in catalog" is the Composio wording and names a thing an MCP
                // server does not have.
                staleLabel: "no longer offered",
                toolOptions,
                presets,
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
