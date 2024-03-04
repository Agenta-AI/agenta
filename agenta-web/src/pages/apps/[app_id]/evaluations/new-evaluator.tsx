import Evaluators from "@/components/pages/evaluations/evaluators/Evaluators"
import {useAppId} from "@/hooks/useAppId"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations"
import {useAtom} from "jotai"
import React, {useEffect} from "react"

const NewEvaluator = () => {
    const appId = useAppId()
    const setEvaluators = useAtom(evaluatorsAtom)[1]
    const setEvaluatorConfigs = useAtom(evaluatorConfigsAtom)[1]

    useEffect(() => {
        Promise.all([fetchAllEvaluators(), fetchAllEvaluatorConfigs(appId)]).then(
            ([evaluators, configs]) => {
                setEvaluators(evaluators)
                setEvaluatorConfigs(configs)
            },
        )
    }, [appId])

    return <Evaluators />
}

export default NewEvaluator
