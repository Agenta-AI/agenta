import type {ReactNode} from "react"

import {ButtonProps} from "antd"

import {TestResult} from "@/oss/lib/shared/variant/transformer/types"

export interface SessionDrawerButtonProps extends ButtonProps {
    label?: ReactNode
    icon?: boolean
    children?: ReactNode
    result: TestResult | null | undefined
}
