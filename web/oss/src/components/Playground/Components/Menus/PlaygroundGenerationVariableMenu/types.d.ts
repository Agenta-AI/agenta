import {DropDownProps} from "antd"

import {TestResult} from "@/oss/lib/shared/variant/types/testRun"

export interface PlaygroundGenerationVariableMenuProps extends DropDownProps {
    duplicateRow: () => void
    result?: TestResult | null | undefined
    resultHash?: string | null | undefined
}
