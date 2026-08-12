/**
 * Which agent version a trigger runs, resolved without guessing.
 *
 * The drawer offers two answers: "Latest" (the backend resolves the newest revision at tick time,
 * stored as `application_variant`) and a pinned revision (stored as `application_revision`).
 * Variant identity is part of what gets persisted, so an app with more than one variant cannot be
 * collapsed to "the" variant — reading it back out of storage is the only safe move on edit.
 */
import {useMemo} from "react"

import {
    workflowMolecule,
    workflowRevisionsListQueryStateAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {TriggerReferences} from "./RunVersionField"

export type TriggerBindingMode = "latest" | "pinned"

/** Stable identity for a dirty check — a binding is its mode plus whichever id it pins. */
export function bindingKey(binding: TriggerBinding): string {
    return `${binding.mode}:${binding.workflowId ?? ""}:${binding.variantId ?? ""}:${
        binding.revisionId ?? ""
    }`
}

/**
 * Assemble `data.references`. "Latest" binds the variant so the backend resolves the newest
 * revision on each run; pinning binds the revision itself. Falling back to the stored family
 * keeps a binding the picker can't represent (slug-only, artifact-only) intact on save.
 */
export function buildTriggerReferences(
    binding: TriggerBinding,
    stored?: TriggerReferences,
): TriggerReferences {
    const references: Record<string, {id: string}> = {}
    if (binding.workflowId) references.application = {id: binding.workflowId}
    if (binding.mode === "pinned" && binding.revisionId) {
        references.application_revision = {id: binding.revisionId}
    } else if (binding.variantId) {
        references.application_variant = {id: binding.variantId}
    }
    return Object.keys(references).length ? references : (stored ?? undefined)
}

export interface TriggerBinding {
    mode: TriggerBindingMode
    /** The application artifact. */
    workflowId: string | null
    variantId: string | null
    /** Set only when `mode` is "pinned". */
    revisionId: string | null
}

export const EMPTY_BINDING: TriggerBinding = {
    mode: "latest",
    workflowId: null,
    variantId: null,
    revisionId: null,
}

/**
 * Read a stored `data.references` family back into a binding. A pinned reference names the
 * revision but not always its variant, which {@link useTriggerBinding} fills in from the
 * revision entity.
 */
export function parseStoredBinding(references: TriggerReferences): TriggerBinding {
    if (!references) return EMPTY_BINDING
    const workflowId = references.application?.id ?? null
    const revisionId = references.application_revision?.id ?? null
    if (revisionId) return {mode: "pinned", workflowId, variantId: null, revisionId}
    const variantId = references.application_variant?.id ?? null
    return {mode: "latest", workflowId, variantId, revisionId: null}
}

/**
 * Complete a binding from whatever the drawer knows.
 *
 * - Edit: `storedReferences` wins outright, so opening a trigger can never rebind it.
 * - Playground create: the open revision already names its variant.
 * - Settings create: the chosen agent names the workflow; the variant follows only when the app
 *   has exactly one. Otherwise it stays null and the version picker asks.
 */
export function useTriggerBinding({
    storedReferences,
    playgroundEntityId,
    agentWorkflowId,
}: {
    storedReferences?: TriggerReferences
    playgroundEntityId?: string
    agentWorkflowId?: string | null
}): TriggerBinding {
    const stored = useMemo(
        () => (storedReferences ? parseStoredBinding(storedReferences) : null),
        [storedReferences],
    )

    // A pinned reference carries the revision id; its variant lives on the revision entity.
    const pinnedRevision = useAtomValue(
        workflowMolecule.selectors.data(stored?.revisionId ?? ""),
    ) as {workflow_variant_id?: string | null; workflow_id?: string | null} | null

    // The playground's open revision names both its workflow and its variant.
    const playgroundRevision = useAtomValue(
        workflowMolecule.selectors.data(playgroundEntityId ?? ""),
    ) as {workflow_variant_id?: string | null; workflow_id?: string | null} | null

    const variants = useAtomValue(
        workflowVariantsListQueryStateAtomFamily(
            stored?.workflowId ?? agentWorkflowId ?? playgroundRevision?.workflow_id ?? "",
        ),
    )

    return useMemo(() => {
        if (stored) {
            return {
                ...stored,
                workflowId: stored.workflowId ?? pinnedRevision?.workflow_id ?? null,
                variantId: stored.variantId ?? pinnedRevision?.workflow_variant_id ?? null,
            }
        }
        if (playgroundEntityId) {
            return {
                mode: "latest",
                workflowId: playgroundRevision?.workflow_id ?? playgroundEntityId,
                variantId: playgroundRevision?.workflow_variant_id ?? null,
                revisionId: null,
            }
        }
        const only = variants.data.length === 1 ? variants.data[0] : null
        return {
            mode: "latest",
            workflowId: agentWorkflowId ?? null,
            variantId: only?.id ?? null,
            revisionId: null,
        }
    }, [stored, pinnedRevision, playgroundEntityId, playgroundRevision, agentWorkflowId, variants])
}

/** The revision row a binding points at: the pinned one, else the variant's newest. */
interface BoundRevision {
    id?: string
    version?: number | null
    flags?: {is_agent?: boolean; is_chat?: boolean} | null
    data?: {schemas?: {inputs?: unknown} | null} | null
}

/**
 * Shape of the bound agent's inputs, read off the revision entity rather than
 * `workflowMolecule`. The molecule is scoped to an open app, so on the settings page its
 * selectors never resolve and every trigger read as a non-agent completion workflow.
 */
export function useBoundAgentShape(binding: TriggerBinding): {
    /** False while nothing is bound yet — the shape is unknown, not "not an agent". */
    resolved: boolean
    isAgent: boolean
    isChat: boolean
    inputSchema: unknown
} {
    const revisions = useAtomValue(
        workflowRevisionsListQueryStateAtomFamily(binding.variantId ?? ""),
    )

    return useMemo(() => {
        const rows = (revisions.data as BoundRevision[]).filter((r) => r.version !== 0)
        const bound =
            binding.mode === "pinned" && binding.revisionId
                ? rows.find((r) => r.id === binding.revisionId)
                : [...rows].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
        return {
            resolved: Boolean(bound),
            isAgent: Boolean(bound?.flags?.is_agent),
            isChat: Boolean(bound?.flags?.is_chat),
            inputSchema: bound?.data?.schemas?.inputs ?? null,
        }
    }, [revisions.data, binding.mode, binding.revisionId])
}
