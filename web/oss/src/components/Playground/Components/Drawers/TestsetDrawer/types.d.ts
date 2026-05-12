import type {ReactNode} from "react"

import type {PlaygroundTestResult as TestResult} from "@agenta/playground"

import {EnhancedButtonProps} from "../../../../EnhancedUIs/Button/types"

export interface TestsetDrawerButtonProps extends EnhancedButtonProps {
    icon?: boolean
    children?: ReactNode
    resultHashes?: (TestResult | string | null | undefined)[]
    results?: (TestResult | null | undefined) | (TestResult | null | undefined)[]
    onClickTestsetDrawer?: (messageId?: string) => void
    messageId?: string
}
