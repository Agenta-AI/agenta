export interface AnnotateScenarioButtonProps {
    runId: string
    scenarioId: string
    stepKey: string
    updatedMetrics: Record<string, any>
    disabled?: boolean
    label?: string
    className?: string
    isAnnotated?: boolean // check if annotations are already present

    formatErrorMessages: (requiredMetrics: Record<string, any>) => void
    setErrorMessages: (errorMessages: string[]) => void
    onAnnotate?: () => void
}
