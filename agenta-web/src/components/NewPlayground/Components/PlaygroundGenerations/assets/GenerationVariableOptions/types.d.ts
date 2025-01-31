import {TestResult} from "@/components/NewPlayground/assets/utilities/transformer/types/testRun"

export type GenerationVariableOptionsProps = {
    className?: string
    variantId: string
    rowId: string
    result?: TestResult | null | undefined
    variableId?: string
}
