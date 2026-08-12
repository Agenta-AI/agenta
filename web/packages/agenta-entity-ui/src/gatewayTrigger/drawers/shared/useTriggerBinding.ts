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

/**
 * Which reference family a trigger is bound through. The backend accepts `application_*`,
 * `workflow_*` and `evaluator_*` as parallel families and REJECTS a payload that populates
 * more than one (`core/workflows/service.py`), so a binding has to remember which family it
 * was read from and write back into that same one. UI-created triggers use `application_*`;
 * SDK/API-created ones commonly use `workflow_*`.
 */
export type TriggerReferenceFamily = "application" | "workflow"

const FAMILY_KEYS: Record<
    TriggerReferenceFamily,
    {artifact: string; variant: string; revision: string}
> = {
    application: {
        artifact: "application",
        variant: "application_variant",
        revision: "application_revision",
    },
    workflow: {artifact: "workflow", variant: "workflow_variant", revision: "workflow_revision"},
}

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
    // Write back into the family this binding was read from — migrating a `workflow_*` trigger
    // to `application_*` would change how the backend resolves it.
    const keys = FAMILY_KEYS[binding.family ?? "application"]
    const references: Record<string, {id: string}> = {}
    if (binding.workflowId) references[keys.artifact] = {id: binding.workflowId}
    if (binding.mode === "pinned" && binding.revisionId) {
        references[keys.revision] = {id: binding.revisionId}
    } else if (binding.variantId) {
        references[keys.variant] = {id: binding.variantId}
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
    /** The reference family to read from and write back into. */
    family: TriggerReferenceFamily
}

export const EMPTY_BINDING: TriggerBinding = {
    mode: "latest",
    workflowId: null,
    variantId: null,
    revisionId: null,
    family: "application",
}

/**
 * Read a stored `data.references` family back into a binding. A pinned reference names the
 * revision but not always its variant, which {@link useTriggerBinding} fills in from the
 * revision entity.
 */
export function parseStoredBinding(references: TriggerReferences): TriggerBinding {
    if (!references) return EMPTY_BINDING
    // A trigger written through the SDK usually binds `workflow_*`; the drawer used to read
    // only `application_*` and rendered those as unbound (blank, disabled version picker).
    const family: TriggerReferenceFamily =
        (references.application ??
        references.application_variant ??
        references.application_revision)
            ? "application"
            : (references.workflow ?? references.workflow_variant ?? references.workflow_revision)
              ? "workflow"
              : "application"
    const keys = FAMILY_KEYS[family]
    const workflowId = references[keys.artifact]?.id ?? null
    const revisionId = references[keys.revision]?.id ?? null
    if (revisionId) return {mode: "pinned", workflowId, variantId: null, revisionId, family}
    const variantId = references[keys.variant]?.id ?? null
    return {mode: "latest", workflowId, variantId, revisionId: null, family}
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
                // A variant-only binding names no artifact, and without one the version list has
                // nothing to query — fall back to the open agent's workflow, which is the same
                // artifact. Never overrides a stored id, so it can't rebind the trigger.
                workflowId:
                    stored.workflowId ??
                    pinnedRevision?.workflow_id ??
                    playgroundRevision?.workflow_id ??
                    agentWorkflowId ??
                    null,
                variantId: stored.variantId ?? pinnedRevision?.workflow_variant_id ?? null,
            }
        }
        if (playgroundEntityId) {
            return {
                mode: "latest",
                workflowId: playgroundRevision?.workflow_id ?? playgroundEntityId,
                variantId: playgroundRevision?.workflow_variant_id ?? null,
                revisionId: null,
                family: "application",
            }
        }
        const only = variants.data.length === 1 ? variants.data[0] : null
        return {
            mode: "latest",
            workflowId: agentWorkflowId ?? null,
            variantId: only?.id ?? null,
            revisionId: null,
            family: "application",
        }
    }, [stored, pinnedRevision, playgroundEntityId, playgroundRevision, agentWorkflowId, variants])
}

/** The revision row a binding points at: the pinned one, else the variant's newest. */
export interface BoundRevision {
    id?: string
    version?: number | null
    message?: string | null
    flags?: {is_agent?: boolean; is_chat?: boolean} | null
    data?: {schemas?: {inputs?: unknown} | null} | null
}

/**
 * The revision a binding ACTUALLY runs — the one rule, in one place.
 *
 * Three surfaces need this (the composer's agent shape, the version label, the drift tag) and
 * each had its own copy; the pinned branches had already drifted apart, so the drift tag could
 * name a different version than the label beside it.
 *
 * Both lookups are needed. The variant's revision list is the normal source, but a STORED pinned
 * reference names the revision without its variant (`parseStoredBinding`), leaving the list empty
 * — so the revision entity is the fallback rather than an alternative.
 */
export function useBoundRevision(binding: TriggerBinding): BoundRevision | null {
    const revisions = useAtomValue(
        workflowRevisionsListQueryStateAtomFamily(binding.variantId ?? ""),
    )
    const isPinned = binding.mode === "pinned" && !!binding.revisionId
    const pinnedEntity = useAtomValue(
        workflowMolecule.selectors.data(isPinned ? (binding.revisionId ?? "") : ""),
    ) as BoundRevision | null

    return useMemo(() => {
        // version 0 is the empty initial revision — never what a trigger runs.
        const rows = (revisions.data as BoundRevision[]).filter((r) => r.version !== 0)
        if (isPinned) {
            return rows.find((r) => r.id === binding.revisionId) ?? pinnedEntity ?? null
        }
        return [...rows].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null
    }, [revisions.data, isPinned, binding.revisionId, pinnedEntity])
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
    const bound = useBoundRevision(binding)

    return useMemo(
        () => ({
            resolved: Boolean(bound),
            isAgent: Boolean(bound?.flags?.is_agent),
            isChat: Boolean(bound?.flags?.is_chat),
            inputSchema: bound?.data?.schemas?.inputs ?? null,
        }),
        [bound],
    )
}
