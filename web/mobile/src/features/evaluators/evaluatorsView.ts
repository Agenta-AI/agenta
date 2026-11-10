import {
    parseWorkflowKeyFromUri,
    resolveOutputSchemaProperties,
    type EvaluatorCategory,
    type EvaluatorEntry,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"

export type {EvaluatorCategory}

/** The tabs, in order. The first is the default. */
export const EVALUATOR_CATEGORIES: readonly {key: EvaluatorCategory; label: string}[] = [
    {key: "automatic", label: "Automatic Evaluators"},
    {key: "human", label: "Human Evaluators"},
]

export const isEvaluatorCategory = (value: unknown): value is EvaluatorCategory =>
    value === "automatic" || value === "human"

/** One revision of an evaluator, reduced to what its row shows. */
export interface EvaluatorRevisionRow {
    /** The revision id: the drawer opens on it. */
    id: string
    workflowId: string
    /** The evaluator's name, from its workflow. */
    name: string | null
    slug: string | null
    version: number | null
    createdAt: string | null
    updatedAt: string | null
    updatedById: string | null
    message: string | null
    /** The template key in the revision URI, for example `auto_exact_match`. */
    evaluatorKey: string | null
    /** Output schema keys: what a human evaluator collects. */
    feedbackKeys: string[]
}

/** The evaluator's newest revision, as a row. */
export interface EvaluatorArchivedRow extends EvaluatorRevisionRow {
    archivedAt: string | null
    archivedById: string | null
}

export const toRevisionRow = (
    revision: Workflow,
    workflow: Workflow,
    latestRevision: Workflow,
): EvaluatorRevisionRow => {
    const properties = resolveOutputSchemaProperties(revision.data)
    return {
        id: revision.id,
        workflowId: workflow.id,
        name: workflow.name?.trim() || null,
        slug: workflow.slug?.trim() || null,
        version: revision.version ?? null,
        createdAt: revision.created_at ?? null,
        updatedAt: revision.updated_at ?? revision.created_at ?? null,
        updatedById: revision.updated_by_id ?? revision.created_by_id ?? null,
        message: revision.message?.trim() || null,
        // The key lives on the URI of the newest revision too, so an old revision still has one.
        evaluatorKey: parseWorkflowKeyFromUri(revision.data?.uri ?? latestRevision.data?.uri),
        feedbackKeys: properties ? Object.keys(properties) : [],
    }
}

export const toArchivedRow = ({
    workflow,
    latestRevision,
}: EvaluatorEntry): EvaluatorArchivedRow => ({
    ...toRevisionRow(latestRevision, workflow, latestRevision),
    archivedAt: workflow.deleted_at ?? null,
    archivedById: workflow.deleted_by_id ?? null,
})

/** The evaluator's name for a heading, a dialog or a toast. */
export const evaluatorLabel = (entry: EvaluatorEntry): string =>
    entry.workflow.name?.trim() || entry.workflow.slug?.trim() || "Untitled evaluator"

/** A row of the live list: an evaluator (its latest revision), or one of its older revisions. */
export interface EvaluatorListRow extends EvaluatorRevisionRow {
    /** The evaluator's workflow id on an evaluator row; the revision id on an older revision. */
    key: string
    /** 0 for an evaluator, 1 for an older revision under it. */
    depth: 0 | 1
    /** An evaluator row with revisions before its latest one: it can expand. */
    hasOlder: boolean
}

/**
 * One row per evaluator, in list order, on its latest revision. An expanded evaluator is followed
 * by its older revisions, newest first. Revision 0 is the empty first commit and is not listed.
 */
export const buildEvaluatorRows = (
    entries: readonly EvaluatorEntry[],
    expanded: ReadonlySet<string>,
    olderByWorkflow: ReadonlyMap<string, readonly Workflow[]>,
): EvaluatorListRow[] =>
    entries.flatMap(({workflow, latestRevision}) => {
        const evaluatorRow: EvaluatorListRow = {
            ...toRevisionRow(latestRevision, workflow, latestRevision),
            key: workflow.id,
            depth: 0,
            hasOlder: (latestRevision.version ?? 0) > 1,
        }
        if (!expanded.has(workflow.id)) return [evaluatorRow]
        const older = (olderByWorkflow.get(workflow.id) ?? [])
            .filter((revision) => (revision.version ?? 0) > 0 && revision.id !== latestRevision.id)
            .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
            .map(
                (revision): EvaluatorListRow => ({
                    ...toRevisionRow(revision, workflow, latestRevision),
                    key: revision.id,
                    depth: 1,
                    hasOlder: false,
                }),
            )
        return [evaluatorRow, ...older]
    })

/** Names for a dialog: up to three, then "and N more…". */
export const summarizeNames = (names: readonly string[]): string => {
    const shown = names.slice(0, 3).join(", ")
    return names.length > 3 ? `${shown} and ${names.length - 3} more…` : shown
}
