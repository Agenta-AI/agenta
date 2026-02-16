import type {ABTestingEvaluationTableRow} from "@/oss/components/EvaluationTable/ABTestingEvaluationTable"
import {useLegacyVariants} from "@/oss/lib/hooks/useLegacyVariant"
import type {Evaluation, EvaluationScenario, Variant} from "@/oss/lib/Types"

export interface EvaluationCardViewProps {
    variants: Variant[]
    evaluationScenarios: ABTestingEvaluationTableRow[]
    onRun: (id: string) => void
    onVote: (id: string, vote: string | number | null) => void
    onInputChange: Function
    updateEvaluationScenarioData: (id: string, data: Partial<EvaluationScenario>) => void
    evaluation: Evaluation
    variantData: ReturnType<typeof useLegacyVariants>
    isLoading: boolean
}
