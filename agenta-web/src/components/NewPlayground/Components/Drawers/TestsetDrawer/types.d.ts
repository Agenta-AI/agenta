import {ButtonProps} from "antd"
import {TestResult} from "@/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface TestsetDrawerButtonProps extends ButtonProps {
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    results: (TestResult | null | undefined) | (TestResult | null | undefined)[]
}
