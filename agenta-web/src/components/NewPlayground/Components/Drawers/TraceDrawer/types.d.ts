import {ButtonProps} from "antd"
import {TestResult} from "@/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface TraceDrawerButtonProps extends ButtonProps {
    label?: React.ReactNode
    icon?: boolean
    children?: React.ReactNode
    result: TestResult | null | undefined
}
