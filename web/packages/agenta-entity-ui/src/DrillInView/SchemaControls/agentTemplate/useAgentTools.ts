/**
 * Tool-list management for the Tools section. The `tools` array mixes inline function, builtin,
 * gateway, and `type:"reference"` workflow tools (#4860; the last derives its input schema async).
 * This hook owns those add/remove flows plus the derived sets the section needs.
 */
import {useCallback, useMemo, type MutableRefObject} from "react"

import type {WorkflowReferenceBridge, WorkflowReferencePayload} from "@agenta/ui/drill-in"

import {migrateIntegration} from "../gatewayMigration"
import {DEFAULT_INTEGRATION_PERMISSIONS, mergeToolPermission} from "../integrationPolicy"
import {
    buildIntegrationRows,
    findGatewayConnectionIndex,
    parseGatewayConnection,
    removeIntegrationRow,
    setGatewayConnectionPermissions,
    upsertGatewayConnection,
    type GatewayConnectionPermissions,
    type GatewayConnectionTarget,
    type GatewayPermission,
    type IntegrationRow,
} from "../toolUtils"

import {toolReferenceSlug} from "./itemDescriptors"
import type {ItemKind} from "./itemKinds"

export function useAgentTools({
    config,
    onChange,
    configRef,
    openCreate,
    workflowReference,
}: {
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    /** Latest config, so an async reference add doesn't clobber a concurrent edit. */
    configRef: MutableRefObject<Record<string, unknown>>
    /** Opens the shared item-config drawer in "create" mode (for inline function tools). */
    openCreate: (kind: ItemKind, seed: Record<string, unknown>, view: "form" | "json") => void
    workflowReference?: WorkflowReferenceBridge
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

    // Append a `type:"reference"` tool for a workflow chosen in the reference drawer (#4860),
    // auto-deriving its model-facing input schema from the workflow's latest revision. The axis
    // (variant/environment), pinned version, and environment come from the drawer's payload.
    const handleAddWorkflowReference = useCallback(
        async (payload: WorkflowReferencePayload) => {
            const wf = workflowReference?.workflows.find((w) => w.slug === payload.slug)
            let inputSchema: Record<string, unknown> | null = null
            try {
                inputSchema = wf
                    ? ((await workflowReference?.resolveInputSchema(wf)) ?? null)
                    : null
            } catch {
                inputSchema = null
            }
            // Read the freshest tools after the async lookup so a concurrent add/remove isn't clobbered.
            const latest = configRef.current
            const latestTools = Array.isArray(latest.tools) ? (latest.tools as unknown[]) : []
            if (latestTools.some((t) => toolReferenceSlug(t) === payload.slug)) return
            // No variant id: ReferenceToolConfig has no such field and forbids unknown ones.
            const referenceTool: Record<string, unknown> = {
                type: "reference",
                ref_by: payload.refBy,
                slug: payload.slug,
                ...(payload.refBy === "variant" && payload.version
                    ? {version: payload.version}
                    : {}),
                ...(payload.refBy === "environment" && payload.environment
                    ? {environment: payload.environment}
                    : {}),
                name: wf?.name || payload.slug,
                description: payload.description ?? wf?.description ?? wf?.name ?? "",
                input_schema: inputSchema ?? {type: "object", properties: {}},
            }
            onChange({...latest, tools: [...latestTools, referenceTool]})
        },
        [workflowReference, onChange, configRef],
    )

    // Removal by SLUG: a reference's display name is editable and can match another tool.
    const handleRemoveReferenceBySlug = useCallback(
        (slug: string) => setTools(tools.filter((tool) => toolReferenceSlug(tool) !== slug)),
        [tools, setTools],
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

    const removeIntegration = useCallback(
        (row: IntegrationRow) => setTools(removeIntegrationRow(tools, row)),
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
        handleAddWorkflowReference,
        handleRemoveReferenceBySlug,
        integrationRows,
        setIntegrationConnection,
        setIntegrationPermissions,
        setIntegrationToolPermission,
        removeIntegration,
        migrateIntegrationEntries,
    }
}
