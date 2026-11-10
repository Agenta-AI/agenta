import {useCallback, useState} from "react"

import {invalidateTestsetCache, updateTestsetMetadata} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

/**
 * Saves the name and description of a test set. This changes the test set, not a revision, so
 * the version stays. Answers whether it saved; a failure shows one fixed sentence and the cause
 * goes to the console.
 */
export function useUpdateTestsetDetails({
    projectId,
    testsetId,
}: {
    projectId: string
    testsetId: string | undefined
}) {
    const queryClient = useQueryClient()
    const [pending, setPending] = useState(false)

    const save = useCallback(
        async (name: string, description: string): Promise<boolean> => {
            if (!testsetId) {
                message.error("Test set not found")
                return false
            }
            const trimmed = name.trim()
            if (!trimmed) return false
            setPending(true)
            try {
                await updateTestsetMetadata({
                    projectId,
                    testsetId,
                    name: trimmed,
                    description: description.trim(),
                })
                invalidateTestsetCache(testsetId)
                await queryClient.invalidateQueries({queryKey: ["testsets"]})
                message.success("Test set details updated")
                return true
            } catch (cause) {
                console.error("Updating the test set details failed", cause)
                message.error("Failed to update test set details")
                return false
            } finally {
                setPending(false)
            }
        },
        [projectId, queryClient, testsetId],
    )

    return {save, pending}
}
