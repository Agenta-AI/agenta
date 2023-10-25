import ABTestingEvaluationTable from "@/components/EvaluationTable/ABTestingEvaluationTable"
import {Evaluation} from "@/lib/Types"
import {loadEvaluation, loadEvaluationsScenarios} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useEffect} from "react"
import {fetchVariants} from "@/lib/services/api"
import {useAtom} from "jotai"
import {evaluationAtom, evaluationScenariosAtom} from "@/lib/atoms/evaluation"

export default function Evaluation() {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const [evaluationScenarios, setEvaluationScenarios] = useAtom(evaluationScenariosAtom)
    const [evaluation, setEvaluation] = useAtom(evaluationAtom)
    const appId = router.query.app_id as string
    const columnsCount = 2

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
            const backendVariants = await fetchVariants(appId)
            // Create a map for faster access to first array elements
            let backendVariantsMap = new Map()
            backendVariants.forEach((obj) => backendVariantsMap.set(obj.variantId, obj))

            // Update variants in second object
            evaluation.variants = evaluation.variants.map((variant) => {
                let backendVariant = backendVariantsMap.get(variant.variantId)
                return backendVariant ? backendVariant : variant
            })
            setEvaluation(evaluation)
        }

        init()
    }, [evaluationTableId])

    return (
        <div className="evalautionContainer">
            {evaluationTableId && evaluationScenarios && evaluation && (
                <ABTestingEvaluationTable
                    columnsCount={columnsCount}
                    evaluationScenarios={evaluationScenarios as any[]}
                    evaluation={evaluation}
                />
            )}
        </div>
    )
}
