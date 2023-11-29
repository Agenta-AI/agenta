import CustomCodeRunEvaluationTable from "../../../../../components/EvaluationTable/CustomCodeRunEvaluationTable"
import {Evaluation} from "@/lib/Types"
import {loadEvaluation, loadEvaluationsScenarios, loadTestset} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {fetchVariants} from "@/lib/services/api"
import {getTestsetChatColumn} from "@/lib/helpers/testset"

export default function Evaluation() {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const customEvaluationId = router.query.custom_eval_id as string
    const [evaluationScenarios, setEvaluationScenarios] = useState([])
    const [evaluation, setEvaluation] = useState<Evaluation | undefined>()
    const appId = router.query.app_id as string
    const columnsCount = 1

    useEffect(() => {
        if (!evaluation) {
            return
        }
        const init = async () => {
            const data = await loadEvaluationsScenarios(evaluationTableId, evaluation)
            setEvaluationScenarios(data)
        }
        init()
    }, [evaluation, evaluationTableId])

    useEffect(() => {
        if (!evaluationTableId) {
            return
        }
        const init = async () => {
            const evaluation: Evaluation = await loadEvaluation(evaluationTableId)
            const backendVariants = await fetchVariants(appId)
            const testset = await loadTestset(evaluation.testset._id)
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
            {evaluationTableId && evaluationScenarios && evaluation && customEvaluationId && (
                <CustomCodeRunEvaluationTable
                    columnsCount={columnsCount}
                    evaluationScenarios={evaluationScenarios}
                    evaluation={evaluation}
                    customEvaluationId={customEvaluationId}
                />
            )}
        </div>
    )
}
