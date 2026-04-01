import {memo} from "react"

import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {evaluatorMolecule} from "@agenta/entities/evaluator"
import {Skeleton, Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"

interface EvaluatorNamesCellProps {
    runId: string | undefined
}

/**
 * Cell that renders evaluator names for a queue.
 *
 * Resolution chain:
 * 1. Read evaluation run data via runId (batch-fetched)
 * 2. Extract evaluator workflow IDs from annotation step references
 * 3. Read evaluator entity data for each ID (batch-fetched)
 * 4. Display evaluator names
 */
const EvaluatorNamesCell = memo(function EvaluatorNamesCell({runId}: EvaluatorNamesCellProps) {
    if (!runId) return null
    return <EvaluatorIdsBridge runId={runId} />
})

/** Reads evaluation run → extracts evaluator IDs → delegates to name resolution */
const EvaluatorIdsBridge = memo(function EvaluatorIdsBridge({runId}: {runId: string}) {
    const rawQuery = useAtomValue(evaluationRunMolecule.atoms.query(runId))
    const evaluatorIds = useAtomValue(evaluationRunMolecule.selectors.evaluatorIds(runId))

    if (rawQuery.isPending && evaluatorIds.length === 0) {
        return <Skeleton.Button active size="small" style={{width: 80, height: 22}} />
    }

    if (evaluatorIds.length === 0) return null

    return <EvaluatorNamesList evaluatorIds={evaluatorIds} />
})

/** Resolves evaluator names from IDs and renders tags */
const EvaluatorNamesList = memo(function EvaluatorNamesList({
    evaluatorIds,
}: {
    evaluatorIds: string[]
}) {
    const names = evaluatorIds.map((id) => <EvaluatorNameTag key={id} evaluatorId={id} />)

    if (names.length <= 2) {
        return <div className="flex items-center gap-1 overflow-hidden">{names}</div>
    }

    const visible = names.slice(0, 2)
    const remainingIds = evaluatorIds.slice(2)

    return (
        <div className="flex items-center gap-1 overflow-hidden">
            {visible}
            <Tooltip
                title={
                    <div className="flex flex-col gap-1">
                        {remainingIds.map((id) => (
                            <EvaluatorNameSpan key={id} evaluatorId={id} />
                        ))}
                    </div>
                }
            >
                <Tag className="cursor-default">+{remainingIds.length}</Tag>
            </Tooltip>
        </div>
    )
})

/** Single evaluator name tag — subscribes to evaluator entity for its name */
const EvaluatorNameTag = memo(function EvaluatorNameTag({evaluatorId}: {evaluatorId: string}) {
    const name = useAtomValue(evaluatorMolecule.selectors.name(evaluatorId))
    const slug = useAtomValue(evaluatorMolecule.selectors.slug(evaluatorId))

    return <Tag>{name || slug || evaluatorId.slice(0, 8)}</Tag>
})

/** Single evaluator name span (for tooltip) */
const EvaluatorNameSpan = memo(function EvaluatorNameSpan({evaluatorId}: {evaluatorId: string}) {
    const name = useAtomValue(evaluatorMolecule.selectors.name(evaluatorId))
    const slug = useAtomValue(evaluatorMolecule.selectors.slug(evaluatorId))

    return <span>{name || slug || evaluatorId.slice(0, 8)}</span>
})

export default EvaluatorNamesCell
