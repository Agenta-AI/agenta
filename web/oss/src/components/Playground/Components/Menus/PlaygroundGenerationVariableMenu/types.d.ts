import type {PlaygroundTestResult as TestResult} from "@agenta/playground"

export interface PlaygroundGenerationVariableMenuProps {
    duplicateRow: () => void
    result?: TestResult | null | undefined
    resultHash?: string | null | undefined
}
