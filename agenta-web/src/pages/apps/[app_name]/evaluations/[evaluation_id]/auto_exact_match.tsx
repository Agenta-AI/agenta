import ExactMatchEvaluationTable from "../../../../../components/EvaluationTable/ExactMatchEvaluationTable"
import {AppEvaluation} from "@/lib/Types"
import {loadAppEvaluation, loadEvaluationsRows} from "@/lib/services/api"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {fetchVariants} from "@/lib/services/api"

export default function Evaluation() {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const [evaluationRows, setEvaluationRows] = useState([])
    const [appEvaluation, setAppEvaluation] = useState<AppEvaluation | undefined>()
    const appName = router.query.app_name as unknown as string
    const columnsCount = 1

    useEffect(() => {
        const init = async () => {
            const data = await loadEvaluationsRows(evaluationTableId)
            setEvaluationRows(data)
        }
        init()
    }, [])

    useEffect(() => {
        if (!evaluationTableId) {
            return
        }
        const init = async () => {
            const appEvaluation: AppEvaluation = await loadAppEvaluation(evaluationTableId)
            const backendVariants = await fetchVariants(appName)
            // Create a map for faster access to first array elements
            let backendVariantsMap = new Map()
            backendVariants.forEach((obj) => backendVariantsMap.set(obj.variantName, obj))

            // Update variants in second object
            appEvaluation.variants = appEvaluation.variants.map((variant) => {
                let backendVariant = backendVariantsMap.get(variant.variantName)
                return backendVariant ? backendVariant : variant
            })
            setAppEvaluation(appEvaluation)
        }

        init()
    }, [evaluationTableId])

    return (
        <div style={{marginBottom: "200px"}}>
            {evaluationTableId && evaluationRows && appEvaluation && (
                <ExactMatchEvaluationTable
                    columnsCount={columnsCount}
                    evaluationRows={evaluationRows}
                    appEvaluation={appEvaluation}
                />
            )}
        </div>
    )
}
