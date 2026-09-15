/**
 * One connected MCP server: what it is, what it exposes, and how to change or end it.
 *
 * Tools are shown read-only here on purpose. A permission is a property of an agent's
 * configuration, not of the connection — two agents can share one server and be allowed
 * different things — so this says what exists and sends the person to the agent to decide
 * what it may do.
 *
 * Renaming changes the label and nothing else. The slug agents resolve is frozen, so a
 * rename never repoints a configured agent, and it never resets a policy.
 */
import {useCallback, useEffect, useState} from "react"

import {
    connectionNameProblem,
    editMcpEndpoint,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    listMcpTools,
    type MCPEndpoint,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Field, Input} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

export interface McpConnectionDetailProps {
    endpoint: MCPEndpoint | null
    onClose: () => void
    /** Other connections' display names, so a rename cannot collide. */
    existingNames?: (string | null | undefined)[]
    onReconnect: (endpoint: MCPEndpoint) => void
    onDisconnect: (endpoint: MCPEndpoint) => void
    onChanged?: () => void
}

type ToolsState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready"; tools: McpToolSummary[]}
    | {status: "failed"; error: string}

export default function McpConnectionDetail({
    endpoint,
    onClose,
    existingNames = [],
    onReconnect,
    onDisconnect,
    onChanged,
}: McpConnectionDetailProps) {
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const [name, setName] = useState("")
    const [saving, setSaving] = useState(false)
    const [tools, setTools] = useState<ToolsState>({status: "idle"})

    const connectionState = endpoint ? getMcpConnectionState(endpoint) : null
    const isReady = connectionState === "ready"

    useEffect(() => {
        setName(endpoint?.name || endpoint?.slug || "")
    }, [endpoint])

    const loadTools = useCallback(async () => {
        if (!endpoint?.slug || !isReady) return
        setTools({status: "loading"})
        try {
            setTools({status: "ready", tools: await listMcpTools(endpoint.slug, projectId)})
        } catch (error) {
            setTools({
                status: "failed",
                error: (error as Error)?.message || "The tool list could not be read.",
            })
        }
    }, [endpoint?.slug, isReady, projectId])

    // Only a connected server has tools to report; an unauthorized one would just 409.
    useEffect(() => {
        if (endpoint && isReady) void loadTools()
        else setTools({status: "idle"})
    }, [endpoint, isReady, loadTools])

    const nameProblem = endpoint
        ? connectionNameProblem({name, existingNames, currentName: endpoint.name})
        : null

    const rename = useCallback(async () => {
        if (!endpoint?.id || nameProblem) return
        setSaving(true)
        try {
            // A full replace: every field the row already has is sent back with it, because
            // the edit route writes what it is given rather than merging.
            await editMcpEndpoint(
                {
                    id: endpoint.id,
                    name: name.trim(),
                    description: endpoint.description,
                    auth_mode: endpoint.auth_mode,
                    secret_id: endpoint.secret_id,
                    data: endpoint.data,
                    flags: endpoint.flags,
                },
                projectId,
            )
            message.success("Connection renamed.")
            onChanged?.()
        } catch (error) {
            message.error((error as Error)?.message || "The connection could not be renamed.")
        } finally {
            setSaving(false)
        }
    }, [endpoint, name, nameProblem, onChanged, projectId])

    return (
        <EnhancedDrawer
            open={!!endpoint}
            onClose={onClose}
            title={endpoint?.name || endpoint?.slug || "Connection"}
            width={520}
            destroyOnClose
        >
            {endpoint ? (
                <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-2">
                        <Tag tone={isReady ? "green" : "gold"} className="m-0 text-xs">
                            {getMcpConnectionStateLabel(connectionState ?? "needs_auth")}
                        </Tag>
                        <span
                            className="truncate text-xs text-colorTextDescription"
                            title={endpoint.data.route.base_url ?? undefined}
                        >
                            {endpoint.data.route.base_url}
                        </span>
                    </div>

                    <Field label="Name" error={nameProblem ?? undefined}>
                        <Input
                            value={name}
                            aria-label="Connection name"
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    {/* Said out loud, because renaming something an agent uses invites the
                        opposite assumption. */}
                    <p className="-mt-3 text-xs text-colorTextDescription">
                        Agents keep using this connection under its existing reference, so renaming
                        it here does not change any agent.
                    </p>
                    <div>
                        <Button
                            onClick={rename}
                            disabled={
                                saving || !!nameProblem || name.trim() === (endpoint.name ?? "")
                            }
                        >
                            Save name
                        </Button>
                    </div>

                    <section className="flex flex-col gap-2">
                        <h4 className="m-0 text-sm font-medium text-colorText">Tools</h4>
                        <ToolList state={tools} isReady={isReady} onRetry={loadTools} />
                        <p className="m-0 text-xs text-colorTextDescription">
                            Choose what this server may do in an agent&apos;s configuration.
                        </p>
                    </section>

                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => onReconnect(endpoint)}>
                            {isReady ? "Reconnect" : "Connect"}
                        </Button>
                        {isReady ? (
                            <Button variant="ghost" onClick={() => onDisconnect(endpoint)}>
                                Disconnect
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </EnhancedDrawer>
    )
}

const ToolList = ({
    state,
    isReady,
    onRetry,
}: {
    state: ToolsState
    isReady: boolean
    onRetry: () => void
}) => {
    if (!isReady) {
        return (
            <p className="m-0 text-sm text-colorTextDescription">
                Connect this server to see the tools it exposes.
            </p>
        )
    }
    if (state.status === "loading") {
        return (
            <p className="m-0 text-sm text-colorTextDescription" role="status">
                Reading the tool list…
            </p>
        )
    }
    if (state.status === "failed") {
        // Connected, with a tool problem. Nothing here suggests reauthorizing.
        return (
            <div className="flex flex-col items-start gap-2">
                <p className="m-0 text-sm text-colorErrorText">{state.error}</p>
                <Button variant="ghost" onClick={onRetry}>
                    Retry tools
                </Button>
            </div>
        )
    }
    if (state.status === "ready" && state.tools.length === 0) {
        // An empty list, not a transport failure.
        return (
            <p className="m-0 text-sm text-colorTextDescription">
                This server exposes no tools yet.
            </p>
        )
    }
    if (state.status !== "ready") return null

    return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.tools.map((tool) => (
                <li key={tool.name} className="flex flex-col gap-0.5">
                    <span className="text-sm text-colorText">{tool.name}</span>
                    {tool.description ? (
                        <span className="text-xs text-colorTextDescription">
                            {tool.description}
                        </span>
                    ) : null}
                </li>
            ))}
        </ul>
    )
}
