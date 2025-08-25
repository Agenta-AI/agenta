import {TestResult} from "@/oss/components/Playground/assets/utilities/transformer/types/testRun"

export interface GenerationResultUtilsProps {
    className?: string
    result: TestResult | null | undefined
    showStatus?: boolean
}
