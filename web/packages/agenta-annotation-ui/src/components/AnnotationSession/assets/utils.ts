export function getAddToTestsetDisabledReason({
    scenarioId,
    isCompleted,
    isSubmitting,
    hasPendingChanges,
}: {
    scenarioId: string
    isCompleted: boolean
    isSubmitting: boolean
    hasPendingChanges: boolean
}): string | null {
    if (!scenarioId) return "Select a scenario before adding it to a testset."
    if (hasPendingChanges && !isCompleted) return "Save annotations before adding to a testset."
    if (isSubmitting) return "Saving annotations"
    return null
}
