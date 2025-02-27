import {useEffect, useState} from "react"

import {useRouter} from "next/router"

import SingleModelEvaluationTable from "@/oss/components/EvaluationTable/SingleModelEvaluationTable"
import {getTestsetChatColumn} from "@/oss/lib/helpers/testset"
import type {Evaluation, EvaluationScenario, GenericObject} from "@/oss/lib/Types"
import {fetchVariants} from "@/oss/services/api"
import {
    fetchLoadEvaluation,
    fetchAllLoadEvaluationsScenarios,
} from "@/oss/services/human-evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"

import "@ag-grid-community/styles/ag-grid.css"
import "@ag-grid-community/styles/ag-theme-alpine.css"

export default function Evaluation() {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const [evaluationScenarios, setEvaluationScenarios] = useState<EvaluationScenario[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [evaluation, setEvaluation] = useState<Evaluation>()
    const appId = router.query.app_id as string

    useEffect(() => {
        if (!evaluation) {
            return
        }
        const init = async () => {
            setIsLoading(true)
            try {
                const data = await fetchAllLoadEvaluationsScenarios(evaluationTableId, evaluation)
                setEvaluationScenarios(
                    data.map((item: GenericObject) => {
                        const numericScore = parseInt(item.score)
                        return {...item, score: isNaN(numericScore) ? null : numericScore}
                    }),
                )
            } finally {
                setTimeout(() => setIsLoading(false), 1000)
            }
        }
        init()
    }, [evaluation, evaluationTableId])

    useEffect(() => {
        if (!evaluationTableId) {
            return
        }
        const init = async () => {
            const evaluation: Evaluation = await fetchLoadEvaluation(evaluationTableId)
            const backendVariants = await fetchVariants(appId)
            const testset = await fetchTestset(evaluation.testset._id)
            // Create a map for faster access to first array elements
            const backendVariantsMap = new Map()
            backendVariants.forEach((obj) => backendVariantsMap.set(obj.variantId, obj))

            // Update variants in second object
            evaluation.variants = evaluation.variants.map((variant) => {
                const backendVariant = backendVariantsMap.get(variant.variantId)
                return backendVariant ? backendVariant : variant
            })
            evaluation.testset = {
                ...evaluation.testset,
                ...testset,
                testsetChatColumn: getTestsetChatColumn(testset.csvdata),
            }
            setEvaluation(evaluation)
        }

        init()
    }, [evaluationTableId, appId])

    return (
        <div className="evalautionContainer">
            {evaluationTableId && evaluationScenarios && evaluation && (
                <SingleModelEvaluationTable
                    evaluationScenarios={evaluationScenarios as any[]}
                    evaluation={evaluation}
                    isLoading={isLoading}
                />
            )}
        </div>
    )
}
