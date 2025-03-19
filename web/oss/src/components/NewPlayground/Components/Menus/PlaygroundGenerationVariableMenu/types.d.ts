import {DropDownProps} from "antd"

import {TestResult} from "@/oss/components/NewPlayground/assets/utilities/transformer/types/testRun"

export interface PlaygroundGenerationVariableMenuProps extends DropDownProps {
    duplicateInputRow: () => void
    result?: TestResult | null | undefined
    resultHash?: string | null | undefined
}
