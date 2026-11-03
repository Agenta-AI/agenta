import {
    parseWorkflowKeyFromUri,
    resolveOutputSchemaProperties,
    type EvaluatorCategory,
    type EvaluatorEntry,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import type {ListTableGroup} from "@agenta/ui/list-table"

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

/**
 * One group per evaluator, in list order, holding its revisions newest first. Revision 0 is the
 * empty first commit and is not listed. An evaluator with no revision on the loaded pages gets no
 * group, so a heading never sits over nothing.
 */
export const buildEvaluatorGroups = (
    entries: readonly EvaluatorEntry[],
    revisions: readonly Workflow[],
): ListTableGroup<EvaluatorRevisionRow>[] => {
    const byWorkflow = new Map<string, Workflow[]>()
    for (const revision of revisions) {
        if (!revision.workflow_id || !(revision.version && revision.version > 0)) continue
        byWorkflow.set(revision.workflow_id, [
            ...(byWorkflow.get(revision.workflow_id) ?? []),
            revision,
        ])
    }

    return entries.flatMap((entry) => {
        const own = (byWorkflow.get(entry.workflow.id) ?? []).sort(
            (a, b) => (b.version ?? 0) - (a.version ?? 0),
        )
        if (own.length === 0) return []
        const newest = entry.latestRevision.version
        return [
            {
                key: entry.workflow.id,
                label: newest ? `${evaluatorLabel(entry)} v${newest}` : evaluatorLabel(entry),
                rows: own.map((revision) =>
                    toRevisionRow(revision, entry.workflow, entry.latestRevision),
                ),
            },
        ]
    })
}

/** Names for a dialog: up to three, then "and N more…". */
export const summarizeNames = (names: readonly string[]): string => {
    const shown = names.slice(0, 3).join(", ")
    return names.length > 3 ? `${shown} and ${names.length - 3} more…` : shown
}
