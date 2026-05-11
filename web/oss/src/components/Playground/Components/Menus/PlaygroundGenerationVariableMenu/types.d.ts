import type {PlaygroundTestResult as TestResult} from "@agenta/playground"
import {DropDownProps} from "antd"

export interface PlaygroundGenerationVariableMenuProps extends DropDownProps {
    duplicateRow: () => void
    result?: TestResult | null | undefined
    resultHash?: string | null | undefined
}
