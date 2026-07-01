/**
 * Tool-list management for the Tools section. The `tools` array mixes inline function, builtin,
 * gateway, and `type:"reference"` workflow tools (#4860; the last derives its input schema async).
 * This hook owns those add/remove flows plus the derived sets the section needs.
 */
import {useCallback, useMemo, type MutableRefObject} from "react"

import type {WorkflowReferenceBridge, WorkflowReferencePayload} from "@agenta/ui/drill-in"

import type {ToolSelectionMeta} from "../ToolSelectorPopover"
import type {ToolObj} from "../toolUtils"

import {isBuiltinPayloadMatch, toolName, toolReferenceSlug} from "./itemDescriptors"
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

    const handleAddTool = useCallback(
        (tool: ToolObj, meta?: ToolSelectionMeta) => {
            // `needsConfig` is a transient routing flag — never persist it in the tool metadata.
            const {needsConfig, ...toolMeta} = meta ?? ({} as ToolSelectionMeta)
            const hasMeta = Object.keys(toolMeta).length > 0
            const next =
                hasMeta && tool && typeof tool === "object" && !Array.isArray(tool)
                    ? {
                          ...(tool as Record<string, unknown>),
                          agenta_metadata: {
                              ...(((tool as Record<string, unknown>).agenta_metadata as
                                  | Record<string, unknown>
                                  | undefined) ?? {}),
                              ...toolMeta,
                          },
                      }
                    : tool
            // Open the config editor (append only on Save) for a custom tool, or a gateway action
            // whose input schema couldn't be resolved — so a half-filled/schema-less tool never
            // lands silently. Complete gateway tools add straight away (gateway is multi-select).
            if (toolMeta.source === "custom" || needsConfig) {
                openCreate("tool", next as Record<string, unknown>, "form")
                return
            }
            setTools([...tools, next])
        },
        [tools, setTools, openCreate],
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
                description: wf?.description ?? wf?.name ?? "",
                input_schema: inputSchema ?? {type: "object", properties: {}},
            }
            onChange({...latest, tools: [...latestTools, referenceTool]})
        },
        [workflowReference, onChange, configRef],
    )

    const handleRemoveToolByName = useCallback(
        (name: string) => setTools(tools.filter((tool) => toolName(tool) !== name)),
        [tools, setTools],
    )

    const handleRemoveBuiltinTool = useCallback(
        (toolToRemove: ToolObj) => {
            let removed = false
            const updated = tools.filter((tool) => {
                if (removed) return true
                if (!isBuiltinPayloadMatch(tool, toolToRemove)) return true
                removed = true
                return false
            })
            if (removed) setTools(updated)
        },
        [tools, setTools],
    )

    const selectedToolNames = useMemo(
        () => new Set(tools.map(toolName).filter((n): n is string => Boolean(n))),
        [tools],
    )

    // Workflows not yet referenced as a tool — the pool the selector drawer offers.
    const referenceableWorkflows = useMemo(() => {
        const referenced = new Set(
            tools.map((t) => toolReferenceSlug(t)).filter((s): s is string => Boolean(s)),
        )
        return (workflowReference?.workflows ?? []).filter((w) => !referenced.has(w.slug))
    }, [tools, workflowReference])

    return {
        tools,
        handleAddTool,
        handleAddWorkflowReference,
        handleRemoveToolByName,
        handleRemoveBuiltinTool,
        selectedToolNames,
        referenceableWorkflows,
    }
}
