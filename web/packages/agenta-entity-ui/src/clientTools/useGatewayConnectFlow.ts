/** Manage gateway-target connection requests from the agent chat tool. */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    isConnectionActive,
    isConnectionValid,
    queryToolConnections,
    toolCatalogDrawerOpenAtom,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {mcpEndpointsQueryAtom, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import type {ClientToolMeta, SettleClientTool} from "@agenta/shared/clientTools"
import {useAtom, useAtomValue} from "jotai"

export type GatewayPlane = "llm" | "mcp"

export interface GatewayTarget {
    plane: GatewayPlane
    name: string
}

/** `meta.input.target`, narrowed and validated — `null` when absent or malformed. */
export const parseGatewayTarget = (input: unknown): GatewayTarget | null => {
    const target = (input as {target?: unknown} | null)?.target
    if (!target || typeof target !== "object") return null
    const plane = (target as {plane?: unknown}).plane
    const name = (target as {name?: unknown}).name
    if (plane !== "llm" && plane !== "mcp") return null
    if (typeof name !== "string" || !name) return null
    return {plane, name}
}

/** `openai` / `acme-notion` verbatim — no catalog lookup available generically across planes. */
export const gatewayTargetLabel = (target: GatewayTarget): string => target.name

export const gatewayConnectedOutput = (target: GatewayTarget): Record<string, unknown> => ({
    connected: true,
    target,
})

export const gatewayDeclinedOutput = (target: GatewayTarget): Record<string, unknown> => ({
    connected: false,
    target,
    reason: "declined",
})

export const gatewayCancelledOutput = (target: GatewayTarget): Record<string, unknown> => ({
    connected: false,
    target,
    reason: "cancelled",
})

/**
 * The person finished with the surface, but we could not read back whether the target is
 * connected. Distinct from "cancelled" on purpose: an agent told the person declined should
 * stop and ask, whereas one told the answer is unknown should look again before either.
 */
export const gatewayUnverifiedOutput = (target: GatewayTarget): Record<string, unknown> => ({
    connected: false,
    target,
    reason: "unverified",
})

export type GatewayConnectPhase = "idle" | "connecting"

/** Return the custom MCP endpoint named by a target, if any. */
export const resolveCustomMcpEndpoint = (
    endpoints: MCPEndpoint[] | undefined,
    target: GatewayTarget,
): MCPEndpoint | null => {
    if (target.plane !== "mcp") return null
    return endpoints?.find((e) => e.namespace === "custom" && e.slug === target.name) ?? null
}

/**
 * The connection a gateway target names, or `null` when the list holds none.
 *
 * `target.name` is the server as the agent's configuration spells it, and that spelling lands in
 * two different key spaces: a connection created against a catalog integration keeps the
 * integration key as its slug, while one the person named themselves carries a slug of its own.
 * Both are checked, because the question this answers is "is THIS target connected" — an answer
 * about some other connection in the same project is not an answer to it.
 */
export const findTargetConnection = (
    connections: ToolConnection[] | undefined,
    target: GatewayTarget,
): ToolConnection | null =>
    (connections ?? []).find(
        (connection) =>
            connection.slug === target.name || connection.integration_key === target.name,
    ) ?? null

/** Whether the target's own connection is in the list and usable right now. */
export const isTargetConnected = (
    connections: ToolConnection[] | undefined,
    target: GatewayTarget,
): boolean => {
    const connection = findTargetConnection(connections, target)
    return !!connection && isConnectionActive(connection) && isConnectionValid(connection)
}

export const useGatewayConnectFlow = (
    target: GatewayTarget,
    meta: ClientToolMeta,
    settle: SettleClientTool,
) => {
    const [phase, setPhase] = useState<GatewayConnectPhase>("idle")
    const [outcome, setOutcome] = useState<{connected: boolean; reason?: string} | null>(null)
    const [providerDrawerOpen, setProviderDrawerOpen] = useState(false)
    const [connectingEndpoint, setConnectingEndpoint] = useState<MCPEndpoint | null>(null)
    const [catalogOpen, setCatalogOpen] = useAtom(toolCatalogDrawerOpenAtom)
    // Whether THIS instance is the one that opened the shared catalog drawer — the atom is
    // shared across every mounted widget, so only the opener may settle on its close.
    const openedCatalogRef = useRef(false)

    const mcpEndpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const customEndpoint = useMemo(
        () => resolveCustomMcpEndpoint(mcpEndpointsQuery.data, target),
        [mcpEndpointsQuery.data, target],
    )

    const settledRef = useRef(false)
    const label = gatewayTargetLabel(target)

    const finish = useCallback(
        (output: Record<string, unknown>) => {
            if (settledRef.current) return
            settledRef.current = true
            setPhase("idle")
            setOutcome({connected: output.connected === true, reason: output.reason as string})
            settle({output})
        },
        [settle],
    )

    // Built-in MCP targets use the shared catalog drawer, which knows nothing about this tool
    // call: it closes the same way whether the person connected the target, connected something
    // else, or browsed and left. So its close only ends the wait. What the agent is told comes
    // from the connections list, read back for this target once the drawer is gone (CR12).
    useEffect(() => {
        if (target.plane !== "mcp") return
        if (!openedCatalogRef.current) return
        if (catalogOpen) return
        openedCatalogRef.current = false
        // No cleanup cancels this: another widget sharing the drawer atom can reopen it while
        // the read is in flight, and dropping the answer there would leave the tool unsettled
        // for good. `finish` is already single-shot.
        //
        // Asked unfiltered and matched here, rather than narrowed by `integration_key`: the
        // target's name is only sometimes an integration key, and a filter on the wrong key
        // space answers "nothing" about a connection that exists. The project's connection
        // list is what the settings surface already reads, so this is one request either way.
        void queryToolConnections()
            .then((response) => {
                finish(
                    isTargetConnected(response.connections, target)
                        ? gatewayConnectedOutput(target)
                        : gatewayCancelledOutput(target),
                )
            })
            .catch(() => {
                finish(gatewayUnverifiedOutput(target))
            })
    }, [catalogOpen, target, finish])

    const runConnect = useCallback(() => {
        if (settledRef.current || meta.settled) return
        setPhase("connecting")
        if (target.plane === "llm") {
            setProviderDrawerOpen(true)
        } else if (customEndpoint) {
            setConnectingEndpoint(customEndpoint)
        } else {
            openedCatalogRef.current = true
            setCatalogOpen(true)
        }
    }, [meta.settled, target, setCatalogOpen, customEndpoint])

    const onProviderSaved = useCallback(() => {
        finish(gatewayConnectedOutput(target))
    }, [finish, target])

    const onProviderClosed = useCallback(() => {
        setProviderDrawerOpen(false)
        if (!settledRef.current && !meta.settled) finish(gatewayCancelledOutput(target))
    }, [finish, meta.settled, target])

    // Custom MCP endpoint connections settle only after dialog success.
    const onMcpConnectSuccess = useCallback(() => {
        setConnectingEndpoint(null)
        finish(gatewayConnectedOutput(target))
    }, [finish, target])

    // Closed without success: discovery failure and an explicit decline both land here
    // (McpConnectDialog renders the discovery error inline first; only closing after either
    // reaches this handler), and both settle as "cancelled" — the same terminal shape the LLM
    // path already uses for "opened, then closed with nothing to show for it". An explicit
    // decline BEFORE opening (see `decline` below) settles as "declined" instead, so the two
    // stay distinguishable in the settled output.
    const onMcpDialogClosed = useCallback(() => {
        setConnectingEndpoint(null)
        if (!settledRef.current && !meta.settled) finish(gatewayCancelledOutput(target))
    }, [finish, meta.settled, target])

    const decline = useCallback(() => {
        if (settledRef.current || meta.settled) return
        finish(gatewayDeclinedOutput(target))
    }, [finish, meta.settled, target])

    return {
        label,
        phase,
        outcome,
        providerDrawerOpen,
        connectingEndpoint,
        runConnect,
        onProviderSaved,
        onMcpConnectSuccess,
        onMcpDialogClosed,
        onProviderClosed,
        decline,
    }
}
