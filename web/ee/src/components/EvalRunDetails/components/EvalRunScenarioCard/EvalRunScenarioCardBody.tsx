import {FC, memo, useCallback, useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"
import {loadable, selectAtom} from "jotai/utils"

import {
    scenarioStepFamily,
    loadableScenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {renderSkeleton} from "./assets/utils"
import InvocationRun from "./InvocationRun"

interface EvalRunScenarioCardBodyProps {
    scenarioId: string
}

const EvalRunScenarioCardBody: FC<EvalRunScenarioCardBodyProps> = ({scenarioId}) => {
    /* --- atoms & data --- */
    // Base loadable atom for the full scenario entry
    const scenarioLoadableAtom = useMemo(
        () => loadable(scenarioStepFamily(scenarioId)),
        [scenarioId],
    )

    // Narrow selector: array of invocation steps (stable ref unless it changes)
    const invocationSteps = useAtomValue(
        useMemo(
            () =>
                selectAtom(scenarioLoadableAtom, (l) =>
                    l.state === "hasData" ? ((l.data?.invocationSteps as any[]) ?? []) : [],
                ),
            [scenarioLoadableAtom],
        ),
    )

    // Separate selector for the current load state (avoids recomputing array)
    const loadState = useAtomValue(
        useMemo(() => selectAtom(scenarioLoadableAtom, (l) => l.state), [scenarioLoadableAtom]),
    )

    /* --- render content --- */
    const renderRuns = useCallback(() => {
        if (!invocationSteps.length) return null

        return invocationSteps.map((invStep: any) => (
            <InvocationRun key={invStep.id} invStep={invStep} scenarioId={scenarioId} />
        ))
    }, [scenarioId, invocationSteps])

    /* --- loading / error states --- */
    // Determine if we truly have no cached data for this scenario yet
    const hasCachedSteps = useAtomValue(
        useMemo(
            () =>
                selectAtom(
                    loadableScenarioStepFamily(scenarioId),
                    (l) => l.state === "hasData" && l.data !== undefined,
                ),
            [scenarioId],
        ),
    )
    const isInitialLoading = loadState === "loading" && !hasCachedSteps

    if (isInitialLoading) {
        return renderSkeleton()
    }
    if (loadState === "hasError") {
        return <Typography.Text type="danger">Failed to load scenario data.</Typography.Text>
    }

    if (!invocationSteps.length) return null

    return <div className="flex flex-col gap-6 w-full">{renderRuns()}</div>
}

export default memo(EvalRunScenarioCardBody)
