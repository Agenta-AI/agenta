import {Evaluation} from "@/lib/Types"
import {loadEvaluation, loadEvaluationsScenarios} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {fetchVariants} from "@/lib/services/api"
import RegexEvaluationTable from "@/components/EvaluationTable/RegexEvaluationTable"

export default function Evaluation() {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const [evaluationScenarios, setEvaluationScenarios] = useState([])
    const [evaluation, setEvaluation] = useState<Evaluation | undefined>()
    const appName = router.query.app_name as unknown as string
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
    }, [evaluation])

    useEffect(() => {
        if (!evaluationTableId) {
            return
        }
        const init = async () => {
            const evaluation: Evaluation = await loadEvaluation(evaluationTableId)
            const backendVariants = await fetchVariants(appName)
            // Create a map for faster access to first array elements
            let backendVariantsMap = new Map()
            backendVariants.forEach((obj) => backendVariantsMap.set(obj.variantName, obj))

            // Update variants in second object
            evaluation.variants = evaluation.variants.map((variant) => {
                let backendVariant = backendVariantsMap.get(variant.variantName)
                return backendVariant ? backendVariant : variant
            })
            setEvaluation(evaluation)
        }

        init()
    }, [evaluationTableId])

    return (
        <div className="evalautionContainer">
            {evaluationTableId && evaluationScenarios && evaluation && (
                <RegexEvaluationTable
                    columnsCount={columnsCount}
                    evaluationScenarios={evaluationScenarios}
                    evaluation={evaluation}
                />
            )}
        </div>
    )
}
