import {memo} from "react"

import {EvaluatorMetricsCell as PackagedEvaluatorMetricsCell} from "@agenta/observability-ui"

import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {useProjectData} from "@/oss/state/project"

interface Props {
    invocationKey: string
    evaluatorSlug: string
}

/** Resolves the evaluator's display name and hands it to the packaged cell. */
const EvaluatorMetricsCell = memo(({invocationKey, evaluatorSlug}: Props) => {
    const {projectId} = useProjectData()
    const {reference} = useEvaluatorReference({projectId: projectId ?? null, evaluatorSlug})

    return (
        <PackagedEvaluatorMetricsCell
            invocationKey={invocationKey}
            evaluatorSlug={evaluatorSlug}
            displayName={reference?.name ?? undefined}
        />
    )
})

export default EvaluatorMetricsCell
