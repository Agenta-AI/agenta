import type {ABTestingEvaluationTableRow} from "@/components/EvaluationTable/ABTestingEvaluationTable"
import type {ChatMessage, Evaluation, EvaluationScenario, Variant} from "@/lib/Types"
import {useLegacyVariants} from "@/lib/hooks/useLegacyVariant"

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
