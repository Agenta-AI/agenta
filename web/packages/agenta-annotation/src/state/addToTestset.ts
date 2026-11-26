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
    if (!scenarioId) return "Select an item before adding it to a test set."
    if (hasPendingChanges && !isCompleted)
        return "Mark this item completed before adding it to a test set."
    if (isSubmitting) return "Saving annotations"
    return null
}

/** The commit modes the add-to-testset modal offers. */
export const ADD_TO_TESTSET_COMMIT_MODES = [
    {id: "existing", label: "Existing test set"},
    {id: "new", label: "New test set"},
]

/** The name field the add-to-testset modal shows when it creates a testset. */
export const CREATE_TESTSET_FIELDS = {
    modes: ["new"],
    nameLabel: "Test set name",
    defaultName: ({entity}: {entity: {name?: string} | null}) => entity?.name ?? "",
}
