import type {Evaluation, EvaluationScenario, GenericObject} from "@/lib/Types"
import {
    fetchLoadEvaluation,
    fetchAllLoadEvaluationsScenarios,
} from "@/services/human-evaluations/api"
import {fetchTestset} from "@/services/testsets/api"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {fetchVariants} from "@/services/api"
import {getTestsetChatColumn} from "@/lib/helpers/testset"
import SingleModelEvaluationTable from "@/components/EvaluationTable/SingleModelEvaluationTable"

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
            let backendVariantsMap = new Map()
            backendVariants.forEach((obj) => backendVariantsMap.set(obj.variantId, obj))

            // Update variants in second object
            evaluation.variants = evaluation.variants.map((variant) => {
                let backendVariant = backendVariantsMap.get(variant.variantId)
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
