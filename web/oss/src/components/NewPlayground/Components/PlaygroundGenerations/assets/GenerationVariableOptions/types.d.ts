import {TestResult} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface GenerationVariableOptionsProps {
    className?: string
    variantId: string
    rowId: string
    result?: TestResult | null | undefined
    variableId?: string
}
