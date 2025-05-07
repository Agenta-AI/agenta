import {TestResult} from "@/components/Playground/assets/utilities/transformer/types/testRun"

export interface GenerationVariableOptionsProps {
    className?: string
    variantId: string
    rowId: string
    result?: TestResult | null
    resultHash?: TestResult | string | null
    variableId?: string
}
