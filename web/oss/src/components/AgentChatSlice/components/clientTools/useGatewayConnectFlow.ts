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
 * `plane: "mcp"` opens the shared, already-mounted tool catalog drawer via
 * `toolCatalogDrawerOpenAtom` and settles OPTIMISTICALLY when it closes, because no per-call
 * completion signal is available from that shared surface (see specs-wp26.md "Settle
 * semantics"). This is safe: the gateway re-checks registration on every call regardless of
 * what this widget believed, so a wrong optimistic "connected" only costs one more
 * refusal-and-request round trip, never a false permission.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import {useAtom} from "jotai"

import type {ClientToolMeta, SettleClientTool} from "./types"

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

export const useGatewayConnectFlow = (
    target: GatewayTarget,
    meta: ClientToolMeta,
    settle: SettleClientTool,
) => {
    const [phase, setPhase] = useState<GatewayConnectPhase>("idle")
    const [outcome, setOutcome] = useState<{connected: boolean; reason?: string} | null>(null)
    const [providerDrawerOpen, setProviderDrawerOpen] = useState(false)
    const [catalogOpen, setCatalogOpen] = useAtom(toolCatalogDrawerOpenAtom)
    // Whether THIS instance is the one that opened the shared catalog drawer — the atom is
    // shared across every mounted widget, so only the opener may settle on its close.
    const openedCatalogRef = useRef(false)

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

    // MCP: the shared drawer closing (having been opened by THIS instance) is the only signal
    // this path gets. See module doc for why "closed = done" is optimistic-but-safe.
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
        } else {
            openedCatalogRef.current = true
            setCatalogOpen(true)
        }
    }, [meta.settled, target, setCatalogOpen])

    const onProviderSaved = useCallback(() => {
        finish(gatewayConnectedOutput(target))
    }, [finish, target])

    const onProviderClosed = useCallback(() => {
        setProviderDrawerOpen(false)
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
        runConnect,
        onProviderSaved,
        onProviderClosed,
        decline,
    }
}
