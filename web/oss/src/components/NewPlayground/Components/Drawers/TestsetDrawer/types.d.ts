import type {ReactNode} from "react"

import {TestResult} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/testRun"
import {TooltipButtonProps} from "../../../assets/EnhancedButton"

export interface TestsetDrawerButtonProps extends TooltipButtonProps {
    icon?: boolean
    children?: ReactNode
    resultHashes?: (TestResult | string | null | undefined)[]
    results?: (TestResult | null | undefined) | (TestResult | null | undefined)[]
    onClickTestsetDrawer?: (messageId?: string) => void
    messageId?: string
}
