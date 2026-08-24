/**
 * The gateway-target half of the `request_connection` client tool (WP26, D35 consequence 2).
 *
 * Sibling to `useConnectFlow` (the external-integration OAuth flow), NOT a replacement: this
 * hook only runs when `meta.input.target` is present. The two flows settle the SAME tool call
 * shape (`{connected, reason?, retryable?}` | `{errorText}`) so `ConnectToolWidget`'s settled
 * chip rendering stays shared between both paths.
 *
 * `plane: "llm"` opens `ProviderDrawer` — the project's existing "connect a model provider"
 * surface — and settles on its `onSaved` callback, a real, verified signal.
 *
 * `plane: "mcp"` (WP19 repoint): a `target.name` that matches a registered `custom` MCP
 * endpoint opens `MCPConnectDialog` (the real WP18 surface) and settles on its `onSuccess`
 * callback — a real, verified signal, same footing as the LLM path. This is also the SAME
 * dialog a step-up refusal (`scope_insufficient`) points the agent back at: the request
 * carries no scope list (WP25's marker never recovers one on the MCP plane), so the dialog
 * re-runs `discover()` and re-offers the current scope checklist rather than this widget
 * guessing which ones matter (D17). A `target.name` with no matching `custom` endpoint falls
 * back to the shared tool-catalog drawer via `toolCatalogDrawerOpenAtom` and settles
 * OPTIMISTICALLY when it closes — unchanged from WP26, and still correct for a `builtin`
 * (Composio) target, the one case with no per-call completion signal to read (see
 * specs-wp26.md "Settle semantics"). Safe either way: the gateway re-checks registration and
 * scope on every call regardless of what this widget believed.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import type {ClientToolMeta, SettleClientTool} from "@agenta/shared/clientTools"
import {useAtom, useAtomValue} from "jotai"

import type {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"
import {mcpEndpointsAtom} from "@/oss/state/mcpEndpoints/atoms"

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

export type GatewayConnectPhase = "idle" | "connecting"

/** The `custom` endpoint a `plane: "mcp"` target names, or `null` when it names a
 * `builtin` (Composio) server instead — the only two cases D35 registration allows. */
export const resolveCustomMcpEndpoint = (
    endpoints: MCPEndpoint[] | undefined,
    target: GatewayTarget,
): MCPEndpoint | null => {
    if (target.plane !== "mcp") return null
    return endpoints?.find((e) => e.namespace === "custom" && e.slug === target.name) ?? null
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

    const mcpEndpointsQuery = useAtomValue(mcpEndpointsAtom)
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

    // Fallback only: a `plane: "mcp"` target with no matching `custom` endpoint (a `builtin`
    // server) still goes through the shared catalog drawer, which has no per-call completion
    // signal — the shared drawer closing (having been opened by THIS instance) is the only
    // signal that path gets. See module doc for why "closed = done" is optimistic-but-safe.
    useEffect(() => {
        if (target.plane !== "mcp") return
        if (!openedCatalogRef.current) return
        if (catalogOpen) return
        openedCatalogRef.current = false
        finish(gatewayConnectedOutput(target))
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

    // Real, verified signal (MCPConnectDialog's own postMessage-checked completion) — not the
    // catalog drawer's optimistic close, since a `custom` endpoint now has one (WP19 repoint).
    const onMcpConnectSuccess = useCallback(() => {
        setConnectingEndpoint(null)
        finish(gatewayConnectedOutput(target))
    }, [finish, target])

    // Closed without success: discovery failure and an explicit decline both land here
    // (MCPConnectDialog renders the discovery error inline first; only closing after either
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
