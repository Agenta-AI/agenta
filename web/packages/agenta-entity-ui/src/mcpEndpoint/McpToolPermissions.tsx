/**
 * Per-tool permissions for one MCP connection, inside an agent's configuration.
 *
 * It belongs to the agent, not to the connection: two agents can share one server and be
 * allowed different things, which is why the settings view shows the same tools read-only and
 * sends people here.
 *
 * Three things the table has to say out loud, because getting any of them wrong produces a
 * configuration that reads as safe and is not:
 *
 * - A tool with no row of its own is not unrestricted. It inherits the new-tool default, and
 *   each row says so rather than showing a bare value with no provenance.
 * - The per-tool table is an opt-in. While it is off, the whole-server permission governs and
 *   nothing per-tool is written, so an agent configured before this existed is untouched.
 * - A tool the include filter hides cannot be given a permission. The API refuses such an
 *   entry, so offering one here would produce a config that fails on every run.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    clearPerToolPolicy,
    isPerTool,
    isToolHidden,
    listMcpTools,
    resolvedNewToolPermission,
    setNewToolPermission,
    setToolPermission,
    staleToolPermissions,
    toolPermissions,
    type McpPermission,
    type McpServerPolicy,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"
import {projectIdAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {PermissionPolicySelect} from "../DrillInView/SchemaControls/agentTemplate/PermissionPolicySelect"

export interface McpToolPermissionsProps {
    /** The connection whose tools these are. */
    slug?: string
    policy: McpServerPolicy
    onChange: (policy: McpServerPolicy) => void
    disabled?: boolean
}

/** The three decisions, plus the row-level "same as everything else". */
const TOOL_OPTIONS = [
    {value: "inherit", title: "Inherit", help: "Use the default for tools with no rule."},
    {value: "allow", title: "Allow", help: "Run without asking."},
    {value: "ask", title: "Ask", help: "Pause and ask before running."},
    {value: "deny", title: "Deny", help: "Never run."},
]

const NEW_TOOL_OPTIONS = [
    {value: "ask", title: "Ask", help: "Pause and ask the first time."},
    {value: "allow", title: "Allow", help: "Run without asking."},
    {value: "deny", title: "Deny", help: "Never run."},
]

type ToolsState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready"; tools: McpToolSummary[]}
    | {status: "failed"; error: string}

export default function McpToolPermissions({
    slug,
    policy,
    onChange,
    disabled,
}: McpToolPermissionsProps) {
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const [tools, setTools] = useState<ToolsState>({status: "idle"})

    // Which connection the visible list belongs to. A tool list is fetched per connection and
    // arrives whenever it arrives, so without this, switching connections mid-flight rendered
    // the previous one's tools under the new one's name (M4).
    const shownFor = useRef<string | undefined>(undefined)

    const loadTools = useCallback(async () => {
        if (!slug) return
        shownFor.current = slug
        setTools({status: "loading"})
        try {
            const tools = await listMcpTools(slug, projectId)
            if (shownFor.current !== slug) return
            setTools({status: "ready", tools})
        } catch (error) {
            if (shownFor.current !== slug) return
            setTools({
                status: "failed",
                error: (error as Error)?.message || "The tool list could not be read.",
            })
        }
    }, [projectId, slug])

    useEffect(() => {
        if (slug) void loadTools()
        else setTools({status: "idle"})
    }, [loadTools, slug])

    const perTool = isPerTool(policy)
    const newToolPermission = resolvedNewToolPermission(policy)
    const advertised = tools.status === "ready" ? tools.tools : []
    const stale = useMemo(
        () =>
            staleToolPermissions(
                policy,
                advertised.map((tool) => tool.name),
            ),
        [advertised, policy],
    )

    /**
     * Tools that hold a permission the filter now hides.
     *
     * The API refuses the whole policy for these, so an agent carrying one cannot run at all.
     * The row's own control stays disabled — a hidden tool may not be given a permission — so
     * without somewhere to clear it there was no way to repair the agent from here (CR18).
     */
    const strandedByFilter = useMemo(
        () =>
            Object.keys(toolPermissions(policy))
                .filter((name) => isToolHidden(policy, name))
                .sort(),
        [policy],
    )

    const setTool = useCallback(
        (name: string, value: string) =>
            onChange(
                setToolPermission(
                    policy,
                    name,
                    value === "inherit" ? null : (value as McpPermission),
                ),
            ),
        [onChange, policy],
    )

    if (!slug) {
        return (
            <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">
                Select a connection to choose what this agent may do with it.
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-3" data-testid="mcp-tool-permissions">
            {!perTool ? (
                <div className="flex flex-col items-start gap-1">
                    <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">
                        Every tool on this server follows the server&apos;s own permission.
                    </p>
                    <Button
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => onChange(setNewToolPermission(policy, "ask"))}
                    >
                        Set permissions per tool
                    </Button>
                </div>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                            A tool with no rule of its own
                        </span>
                        <PermissionPolicySelect
                            value={policy.new_tool_permission ?? newToolPermission ?? "ask"}
                            onChange={(value) =>
                                onChange(setNewToolPermission(policy, value as McpPermission))
                            }
                            options={NEW_TOOL_OPTIONS}
                            disabled={disabled}
                            aria-label="Permission for a tool with no rule"
                            size="sm"
                        />
                    </div>

                    <ToolRows
                        state={tools}
                        policy={policy}
                        disabled={disabled}
                        onRetry={loadTools}
                        onSetTool={setTool}
                        inheritLabel={newToolPermission ?? "ask"}
                    />

                    {strandedByFilter.length ? (
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-[var(--ag-colorError)]">
                                Rules for tools this server&apos;s filter hides. The agent cannot
                                run until they are removed.
                            </span>
                            {strandedByFilter.map((name) => (
                                <div key={name} className="flex items-center justify-between gap-2">
                                    <span className="truncate text-field-md">{name}</span>
                                    <Button
                                        variant="ghost"
                                        disabled={disabled}
                                        onClick={() => setTool(name, "inherit")}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {stale.length ? (
                        <div className="flex flex-col gap-1">
                            {/* Kept rather than pruned: a server can stop advertising a tool
                                temporarily, and dropping the decision would re-admit it under
                                the new-tool default when it came back. */}
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                Rules for tools this server no longer advertises
                            </span>
                            {stale.map((name) => (
                                <div key={name} className="flex items-center justify-between gap-2">
                                    <span className="truncate text-field-md">{name}</span>
                                    <Button
                                        variant="ghost"
                                        disabled={disabled}
                                        onClick={() => setTool(name, "inherit")}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div>
                        <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => onChange(clearPerToolPolicy(policy))}
                        >
                            Use the server permission instead
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}

interface ToolRowsProps {
    state: ToolsState
    policy: McpServerPolicy
    disabled?: boolean
    onRetry: () => void
    onSetTool: (name: string, value: string) => void
    inheritLabel: McpPermission
}

const ToolRows = ({state, policy, disabled, onRetry, onSetTool, inheritLabel}: ToolRowsProps) => {
    if (state.status === "loading") {
        return (
            <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]" role="status">
                Reading the tool list…
            </p>
        )
    }
    if (state.status === "failed") {
        return (
            <div className="flex flex-col items-start gap-1">
                <p className="m-0 text-xs text-[var(--ag-colorError)]">{state.error}</p>
                <Button variant="ghost" onClick={onRetry}>
                    Retry tools
                </Button>
            </div>
        )
    }
    if (state.status !== "ready") return null
    if (state.tools.length === 0) {
        return (
            <p className="m-0 text-xs text-[var(--ag-colorTextSecondary)]">
                This server exposes no tools yet.
            </p>
        )
    }

    return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.tools.map((tool) => {
                const hidden = isToolHidden(policy, tool.name)
                const explicit = toolPermissions(policy)[tool.name]
                return (
                    <li key={tool.name} className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-field-md">{tool.name}</span>
                            <span className="truncate text-xs text-[var(--ag-colorTextSecondary)]">
                                {hidden
                                    ? "Hidden by this server's tool filter"
                                    : explicit
                                      ? (tool.description ?? "")
                                      : `Inherits ${inheritLabel}`}
                            </span>
                        </div>
                        <PermissionPolicySelect
                            value={explicit ?? "inherit"}
                            onChange={(value) => onSetTool(tool.name, value)}
                            options={TOOL_OPTIONS}
                            // A hidden tool may not carry a permission: the API refuses the
                            // whole policy, so offering the control would build a config that
                            // fails on every run rather than once at save.
                            disabled={disabled || hidden}
                            aria-label={`Permission for ${tool.name}`}
                            size="sm"
                        />
                    </li>
                )
            })}
        </ul>
    )
}
