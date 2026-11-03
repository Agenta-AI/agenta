/**
 * Which evaluators a list shows.
 *
 * Pure rules, shared by every surface that lists evaluators. The workflow list only carries
 * workflow-level flags (`is_evaluator`); the kind of an evaluator (human or automatic) and
 * whether the platform manages it live on its latest revision, so the caller fetches both.
 */

import type {Workflow} from "./schema"

export type EvaluatorCategory = "automatic" | "human"

/** `active` lists live evaluators; `archived` lists archived ones, newest archive first. */
export type EvaluatorListMode = "active" | "archived"

/** One evaluator: the workflow row and its latest revision. */
export interface EvaluatorEntry {
    workflow: Workflow
    latestRevision: Workflow
}

/**
 * A human evaluator collects feedback. The revision URI is the source of truth
 * (`agenta:builtin:feedback:...`); the feedback flag is the fallback when there is no URI.
 */
export function isHumanEvaluator(revision: Workflow | null | undefined): boolean {
    if (!revision) return false
    const uri = revision.data?.uri
    if (uri) return uri.split(":")[2] === "feedback"
    return Boolean(revision.flags?.is_feedback)
}

/**
 * A managed evaluator is a platform catalog entry (URI rooted at `agenta:`). Evaluators that a
 * user deployed through the SDK have generated URIs and are not managed. The flag lives on the
 * revision, not on the workflow.
 */
export function isManagedEvaluator(revision: Workflow | null | undefined): boolean {
    if (!revision) return false
    return Boolean(revision.flags?.is_managed)
}

/**
 * Pick the evaluators of one category and mode.
 *
 * @param workflows - Evaluator workflows from the workflow query.
 * @param latestRevisions - The latest revision of each workflow, by workflow id.
 */
export function selectEvaluators(
    workflows: readonly Workflow[],
    latestRevisions: ReadonlyMap<string, Workflow>,
    {category, mode}: {category: EvaluatorCategory; mode: EvaluatorListMode},
): EvaluatorEntry[] {
    const entries: EvaluatorEntry[] = []

    for (const workflow of workflows) {
        if (mode === "archived" ? !workflow.deleted_at : workflow.deleted_at) continue
        const latestRevision = latestRevisions.get(workflow.id)
        if (!latestRevision || !isManagedEvaluator(latestRevision)) continue
        if (isHumanEvaluator(latestRevision) !== (category === "human")) continue
        entries.push({workflow, latestRevision})
    }

    if (mode === "archived") {
        // `entries` is a fresh array, so the sort does not reorder the caller's list.
        entries.sort((a, b) =>
            (b.workflow.deleted_at ?? "").localeCompare(a.workflow.deleted_at ?? ""),
        )
    }
    return entries
}
