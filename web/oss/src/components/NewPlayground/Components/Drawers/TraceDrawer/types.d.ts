import type {ReactNode} from "react"

import {ButtonProps} from "antd"

import {TestResult} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface TraceDrawerButtonProps extends ButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    result: TestResult | null | undefined
}
