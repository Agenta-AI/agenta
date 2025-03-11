import type {ReactNode} from "react"

import {ButtonProps} from "antd"

import {TestResult} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface TestsetDrawerButtonProps extends ButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    resultHashes?: (TestResult | string | null | undefined)[]
    results?: (TestResult | null | undefined) | (TestResult | null | undefined)[]
}
