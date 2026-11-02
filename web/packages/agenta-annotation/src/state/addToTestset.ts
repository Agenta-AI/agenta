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

/** The commit modes the add-to-testset modal offers. */
export const ADD_TO_TESTSET_COMMIT_MODES = [
    {id: "existing", label: "Existing testset"},
    {id: "new", label: "New testset"},
]

/** The name field the add-to-testset modal shows when it creates a testset. */
export const CREATE_TESTSET_FIELDS = {
    modes: ["new"],
    nameLabel: "Testset name",
    defaultName: ({entity}: {entity: {name?: string} | null}) => entity?.name ?? "",
}
