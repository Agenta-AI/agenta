/**
 * Which agent version a schedule runs, resolved without guessing.
 *
 * The drawer offers two answers: "Latest" (the backend resolves the newest revision at tick time,
 * stored as `application_variant`) and a pinned revision (stored as `application_revision`).
 * Variant identity is part of what gets persisted, so an app with more than one variant cannot be
 * collapsed to "the" variant — reading it back out of storage is the only safe move on edit.
 */
import {useMemo} from "react"

import {workflowMolecule, workflowVariantsListQueryStateAtomFamily} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {TriggerReferences} from "../shared/RunVersionField"

export type ScheduleBindingMode = "latest" | "pinned"

export interface ScheduleBinding {
    mode: ScheduleBindingMode
    /** The application artifact. */
    workflowId: string | null
    variantId: string | null
    /** Set only when `mode` is "pinned". */
    revisionId: string | null
}

export const EMPTY_BINDING: ScheduleBinding = {
    mode: "latest",
    workflowId: null,
    variantId: null,
    revisionId: null,
}

/**
 * Read a stored `data.references` family back into a binding. A pinned reference names the
 * revision but not always its variant, which {@link useScheduleBinding} fills in from the
 * revision entity.
 */
export function parseStoredBinding(references: TriggerReferences): ScheduleBinding {
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
 * - Edit: `storedReferences` wins outright, so opening a schedule can never rebind it.
 * - Playground create: the open revision already names its variant.
 * - Settings create: the chosen agent names the workflow; the variant follows only when the app
 *   has exactly one. Otherwise it stays null and the version picker asks.
 */
export function useScheduleBinding({
    storedReferences,
    playgroundEntityId,
    agentWorkflowId,
}: {
    storedReferences?: TriggerReferences
    playgroundEntityId?: string
    agentWorkflowId?: string | null
}): ScheduleBinding {
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
