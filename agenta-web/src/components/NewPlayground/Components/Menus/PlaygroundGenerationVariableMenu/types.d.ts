import {TestResult} from "@/components/NewPlayground/assets/utilities/transformer/types/testRun"
import {DropDownProps} from "antd"

export interface PlaygroundGenerationVariableMenuProps extends DropDownProps {
    duplicateInputRow: () => void
    result: TestResult | null | undefined
}
