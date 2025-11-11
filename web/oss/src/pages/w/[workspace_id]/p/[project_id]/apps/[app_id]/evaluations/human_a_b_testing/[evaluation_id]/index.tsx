import {useEffect, useState} from "react"

import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

// Avoid SSR for this heavy component to prevent server-side ReferenceErrors from client-only libs
const ABTestingEvaluationTable = dynamic(
    () => import("@/oss/components/EvaluationTable/ABTestingEvaluationTable"),
    {ssr: false},
)
import useURL from "@/oss/hooks/useURL"
import {evaluationAtom, evaluationScenariosAtom} from "@/oss/lib/atoms/evaluation"
import {getTestsetChatColumn} from "@/oss/lib/helpers/testset"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import type {Evaluation} from "@/oss/lib/Types"
import {
    fetchLoadEvaluation,
    fetchAllLoadEvaluationsScenarios,
} from "@/oss/services/human-evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"
import {projectIdAtom} from "@/oss/state/project"
import {variantsAtom} from "@/oss/state/variant/atoms/fetcher"

export default function Evaluation() {
    const router = useRouter()
    const projectId = useAtomValue(projectIdAtom)
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""
    const [evaluationScenarios, setEvaluationScenarios] = useAtom(evaluationScenariosAtom)
    const [evaluation, setEvaluation] = useAtom(evaluationAtom)
    const [isLoading, setIsLoading] = useState(true)
    const appId = router.query.app_id as string
    const columnsCount = 2
    const {baseAppURL} = useURL()
    // variants from global store
    const variantsStore = useAtomValue(variantsAtom)

    useEffect(() => {
        if (!evaluation || !projectId) {
            return
        }
        const init = async () => {
            setIsLoading(true)
            try {
                const data = await fetchAllLoadEvaluationsScenarios(evaluationTableId, evaluation)
                setEvaluationScenarios(data)
            } finally {
                setTimeout(() => setIsLoading(false), 1000)
            }
        }
        init()
    }, [evaluation, projectId])

    useEffect(() => {
        if (!evaluationTableId) {
            return
        }
        const init = async () => {
            const evaluation: Evaluation = await fetchLoadEvaluation(evaluationTableId)
            const backendVariants = variantsStore
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
    }, [evaluationTableId])

    // breadcrumbs
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                appPage: {
                    label: "human ab testing",
                    href: `${baseAppURL}/${appId}/evaluations?selectedEvaluation=human_ab_testing`,
                },
                "eval-detail": {
                    label: evaluationTableId,
                    value: evaluationTableId,
                },
            },
            type: "append",
            condition: !!evaluationTableId,
        },
        [evaluationTableId],
    )

    return (
        <div className="evaluationContainer">
            {evaluationTableId && evaluationScenarios && evaluation && (
                <ABTestingEvaluationTable
                    columnsCount={columnsCount}
                    evaluationScenarios={evaluationScenarios as any[]}
                    evaluation={evaluation}
                    isLoading={isLoading}
                />
            )}
        </div>
    )
}
