import {memo} from "react"

import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Skeleton, Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"

interface EvaluatorNamesCellProps {
    runId: string | undefined
}

interface EvaluatorEntry {
    evaluatorId: string | null
    evaluatorRevisionId: string | null
    evaluatorSlug: string | null
}

function getEvaluatorEntryKey(entry: EvaluatorEntry) {
    return entry.evaluatorRevisionId ?? entry.evaluatorId ?? entry.evaluatorSlug ?? "unknown"
}

/**
 * Cell that renders evaluator names for a queue.
 *
 * Resolution chain:
 * 1. Read evaluation run data via runId (batch-fetched)
 * 2. Extract evaluator workflow IDs + slugs from annotation step references
 * 3. Read evaluator entity data for each ID (batch-fetched)
 * 4. Display evaluator names, falling back to slug from step refs then truncated ID
 */
const EvaluatorNamesCell = memo(function EvaluatorNamesCell({runId}: EvaluatorNamesCellProps) {
    if (!runId) return null
    return <EvaluatorIdsBridge runId={runId} />
})

/** Reads evaluation run → extracts evaluator IDs + slugs → delegates to name resolution */
const EvaluatorIdsBridge = memo(function EvaluatorIdsBridge({runId}: {runId: string}) {
    const rawQuery = useAtomValue(evaluationRunMolecule.atoms.query(runId))
    const columnDefs = useAtomValue(evaluationRunMolecule.selectors.annotationColumnDefs(runId))

    // Deduplicate by revision first, preserving order
    const evaluatorEntries: EvaluatorEntry[] = []
    const seen = new Set<string>()
    for (const col of columnDefs) {
        const key = col.evaluatorRevisionId ?? col.evaluatorId ?? col.evaluatorSlug
        if (key && !seen.has(key)) {
            seen.add(key)
            evaluatorEntries.push({
                evaluatorId: col.evaluatorId,
                evaluatorRevisionId: col.evaluatorRevisionId,
                evaluatorSlug: col.evaluatorSlug,
            })
        }
    }

    if (rawQuery.isPending && evaluatorEntries.length === 0) {
        return <Skeleton.Button active size="small" style={{width: 80, height: 22}} />
    }

    if (evaluatorEntries.length === 0) return null

    return <EvaluatorNamesList evaluatorEntries={evaluatorEntries} />
})

/** Resolves evaluator names from IDs+slugs and renders tags */
const EvaluatorNamesList = memo(function EvaluatorNamesList({
    evaluatorEntries,
}: {
    evaluatorEntries: EvaluatorEntry[]
}) {
    const names = evaluatorEntries.map((entry) => (
        <EvaluatorNameTag
            key={getEvaluatorEntryKey(entry)}
            evaluatorId={entry.evaluatorId}
            evaluatorRevisionId={entry.evaluatorRevisionId}
            fallbackSlug={entry.evaluatorSlug}
        />
    ))

    if (names.length <= 2) {
        return <div className="flex items-center gap-1 overflow-hidden">{names}</div>
    }

    const visible = names.slice(0, 2)
    const remainingEntries = evaluatorEntries.slice(2)

    return (
        <div className="flex items-center gap-1 overflow-hidden">
            {visible}
            <Tooltip
                title={
                    <div className="flex flex-col gap-1">
                        {remainingEntries.map((entry) => (
                            <EvaluatorNameSpan
                                key={getEvaluatorEntryKey(entry)}
                                evaluatorId={entry.evaluatorId}
                                evaluatorRevisionId={entry.evaluatorRevisionId}
                                fallbackSlug={entry.evaluatorSlug}
                            />
                        ))}
                    </div>
                }
            >
                <Tag className="cursor-default">+{remainingEntries.length}</Tag>
            </Tooltip>
        </div>
    )
})

/** Single evaluator name tag — subscribes to evaluator entity for its name */
const EvaluatorNameTag = memo(function EvaluatorNameTag({
    evaluatorId,
    evaluatorRevisionId,
    fallbackSlug,
}: {
    evaluatorId: string | null
    evaluatorRevisionId: string | null
    fallbackSlug: string | null
}) {
    const lookupId = evaluatorRevisionId ?? evaluatorId ?? ""
    const name = useAtomValue(workflowMolecule.selectors.name(lookupId))
    const slug = useAtomValue(workflowMolecule.selectors.slug(lookupId))
    const fallbackId = evaluatorId ?? lookupId

    return <Tag>{name || fallbackSlug || slug || fallbackId.slice(0, 8)}</Tag>
})

/** Single evaluator name span (for tooltip) */
const EvaluatorNameSpan = memo(function EvaluatorNameSpan({
    evaluatorId,
    evaluatorRevisionId,
    fallbackSlug,
}: {
    evaluatorId: string | null
    evaluatorRevisionId: string | null
    fallbackSlug: string | null
}) {
    const lookupId = evaluatorRevisionId ?? evaluatorId ?? ""
    const name = useAtomValue(workflowMolecule.selectors.name(lookupId))
    const slug = useAtomValue(workflowMolecule.selectors.slug(lookupId))
    const fallbackId = evaluatorId ?? lookupId

    return <span>{name || fallbackSlug || slug || fallbackId.slice(0, 8)}</span>
})

export default EvaluatorNamesCell
