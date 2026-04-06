import type {ReactNode} from "react"

import type {PlaygroundTestResult as TestResult} from "@agenta/playground"
import {ButtonProps} from "antd"

export interface SessionDrawerButtonProps extends ButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    result: TestResult | null | undefined
}
