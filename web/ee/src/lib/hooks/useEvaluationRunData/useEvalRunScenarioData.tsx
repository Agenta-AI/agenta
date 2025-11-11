import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

import {UseEvaluationRunScenarioStepsFetcherResult} from "../useEvaluationRunScenarioSteps/types"

import {scenarioStepFamily} from "./assets/atoms"

const useEvalRunScenarioData = (scenarioId: string) => {
    const stepLoadable = useAtomValue(loadable(scenarioStepFamily(scenarioId)))

    return useMemo(() => {
        let data: UseEvaluationRunScenarioStepsFetcherResult | undefined =
            stepLoadable.state === "hasData" ? stepLoadable.data : undefined

        if (stepLoadable.state === "hasData" && stepLoadable.data?.traces?.length) {
            data = stepLoadable.data
        }
        return data
    }, [stepLoadable])
}

export default useEvalRunScenarioData
