import {memo, useCallback, useMemo} from "react"

import {Card, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {MetricDetailsPopoverWrapper} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
import {evaluationEvaluatorsAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

interface Props {
    runId: string
    evaluatorSlug: string
}

/**
 * Displays all metric definitions for a single evaluator with popovers.
 * Uses jotai selectAtom so only this card re-renders when its evaluator object changes.
 */
const EvaluatorMetricsCard = ({runId, evaluatorSlug}: Props) => {
    const selector = useCallback(
        (list: EvaluatorDto[] | undefined): EvaluatorDto | undefined =>
            (list || []).find((ev) => (ev.slug || ev.id || ev.name) === evaluatorSlug),
        [evaluatorSlug],
    )

    const evaluatorAtom = useMemo(
        () => selectAtom(evaluationEvaluatorsAtom, selector, deepEqual),
        [selector],
    )
    const evaluator = useAtomValue(evaluatorAtom)

    if (!evaluator) return null

    const metricEntries = Object.entries(evaluator.metrics || {})

    return (
        <Card key={evaluatorSlug} className="w-[400px] shrink-0" classNames={{body: "!p-3"}}>
            <Typography.Text type="secondary">{evaluator.name}</Typography.Text>
            <div className="w-full flex flex-col gap-2 mt-2">
                {metricEntries.map(([metricKey, def]) => (
                    <div
                        key={metricKey}
                        className="w-full flex items-center justify-between border border-solid border-gray-200 px-2 py-1.5 rounded-lg hover:scale-[1.02] hover:shadow-sm transition-all"
                    >
                        <Typography.Text className="text-nowrap mr-10">{metricKey}</Typography.Text>
                        <MetricDetailsPopoverWrapper
                            runId={runId}
                            evaluatorSlug={evaluator.slug}
                            evaluatorMetricKey={metricKey}
                            metricType={(def as any)?.type}
                            className="justify-end [&_.ant-space]:!justify-end"
                        />
                    </div>
                ))}
            </div>
        </Card>
    )
}

export default memo(EvaluatorMetricsCard)
