/**
 * Tool-list management for the Integrations section. The `tools` array mixes inline function,
 * builtin, gateway, and `type:"reference"` workflow tools (#4860). This hook owns the integration
 * writes plus the derived sets the section needs; subagents are written by their own views
 * (`subagentReference.ts`).
 */
import {useCallback, useMemo} from "react"

import {migrateIntegration} from "../gatewayMigration"
import {DEFAULT_INTEGRATION_PERMISSIONS, mergeToolPermission} from "../integrationPolicy"
import {
    buildIntegrationRows,
    findGatewayConnectionIndex,
    parseGatewayConnection,
    setGatewayConnectionAccount,
    setGatewayConnectionPermissions,
    upsertGatewayConnection,
    type GatewayConnectionAccount,
    type GatewayConnectionPermissions,
    type GatewayConnectionTarget,
    type GatewayPermission,
} from "../toolUtils"

import type {ItemKind} from "./itemKinds"

export function useAgentTools({
    config,
    onChange,
    openCreate,
}: {
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    /** Opens the shared item-config drawer in "create" mode (for inline function tools). */
    openCreate: (kind: ItemKind, seed: Record<string, unknown>, view: "form" | "json") => void
}) {
    // Tools live as a flat array on the agent definition (the same tool-object shape the
    // prompt control uses, so the backend resolver parses them identically).
    const tools = useMemo(
        () => (Array.isArray(config.tools) ? (config.tools as unknown[]) : []),
        [config.tools],
    )
    const setTools = useCallback(
        (next: unknown[]) => onChange({...config, tools: next}),
        [config, onChange],
    )

    // ── Integrations: one `gateway_connection` entry per provider and integration ────────────
    const integrationRows = useMemo(() => buildIntegrationRows(tools), [tools])

    /**
     * Add an integration, or point an already-configured one at another connection. Either way it
     * is ONE write to ONE entry: the saved format allows a single entry per provider and
     * integration, so appending a second would produce a revision the SDK refuses to parse. A swap
     * keeps the policy the author already set and changes the connection slug alone.
     */
    const setIntegrationConnection = useCallback(
        (target: GatewayConnectionTarget, connectionSlug: string) => {
            const index = findGatewayConnectionIndex(tools, target)
            const existing = index >= 0 ? parseGatewayConnection(tools[index]) : null
            setTools(
                upsertGatewayConnection(tools, {
                    ...target,
                    connection: connectionSlug,
                    permissions: existing?.permissions ?? DEFAULT_INTEGRATION_PERMISSIONS,
                }),
            )
        },
        [tools, setTools],
    )

    /** Add an integration that uses each person's own account, or point a configured one at it. */
    const addPersonalIntegration = useCallback(
        (target: GatewayConnectionTarget) => {
            const index = findGatewayConnectionIndex(tools, target)
            const existing = index >= 0 ? parseGatewayConnection(tools[index]) : null
            setTools(
                upsertGatewayConnection(tools, {
                    ...target,
                    connection: "",
                    accountSource: "user",
                    permissions: existing?.permissions ?? DEFAULT_INTEGRATION_PERMISSIONS,
                }),
            )
        },
        [tools, setTools],
    )

    /** The drawer's "Account" select: a project connection, or each person's own account. */
    const setIntegrationAccount = useCallback(
        (target: GatewayConnectionTarget, account: GatewayConnectionAccount) =>
            setTools(setGatewayConnectionAccount(tools, target, account)),
        [tools, setTools],
    )

    const setIntegrationPermissions = useCallback(
        (target: GatewayConnectionTarget, permissions: GatewayConnectionPermissions) =>
            setTools(setGatewayConnectionPermissions(tools, target, permissions)),
        [tools, setTools],
    )

    const setIntegrationToolPermission = useCallback(
        (target: GatewayConnectionTarget, toolKey: string, permission: GatewayPermission) => {
            const index = findGatewayConnectionIndex(tools, target)
            const current = index >= 0 ? parseGatewayConnection(tools[index]) : null
            if (!current || !toolKey) return
            setTools(
                setGatewayConnectionPermissions(
                    tools,
                    target,
                    mergeToolPermission(current.permissions, toolKey, permission),
                ),
            )
        },
        [tools, setTools],
    )

    /** Fold an integration's legacy entries into one connection entry. An author action only —
     *  never a page load, so viewing an untouched agent never rewrites it. */
    const migrateIntegrationEntries = useCallback(
        (target: GatewayConnectionTarget) => {
            const next = migrateIntegration(tools, target)
            if (next) setTools(next)
        },
        [tools, setTools],
    )

    return {
        tools,
        integrationRows,
        setIntegrationConnection,
        addPersonalIntegration,
        setIntegrationAccount,
        setIntegrationPermissions,
        setIntegrationToolPermission,
        migrateIntegrationEntries,
    }
}
