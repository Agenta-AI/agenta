/**
 * useSaveTestset Hook
 *
 * Hook for saving loadable data as a new testset.
 * Uses the loadable controller's saveAsNewTestset action which delegates to the testset entity API.
 */

import {useCallback, useMemo, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import type {TestsetSavePayload} from "../types"

// ============================================================================
// TYPES
// ============================================================================

interface UseSaveTestsetOptions {
    /** Loadable ID to save data from */
    loadableId: string
    /** Called when save is successful */
    onSuccess?: (payload: TestsetSavePayload) => void
    /** Called when save fails */
    onError?: (error: Error) => void
}

interface UseSaveTestsetReturn {
    /** Save the testset with an optional commit message (name comes from entity state) */
    saveTestset: (commitMessage?: string) => Promise<TestsetSavePayload | null>
    /** Whether save is in progress */
    isSaving: boolean
    /** Error from last save attempt */
    error: Error | null
}

// ============================================================================
// HOOK
// ============================================================================

export function useSaveTestset({
    loadableId,
    onSuccess,
    onError,
}: UseSaveTestsetOptions): UseSaveTestsetReturn {
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    // Get name from loadable entity state
    const nameAtom = useMemo(() => loadableController.selectors.name(loadableId), [loadableId])
    const name = useAtomValue(nameAtom)

    // Get save action from loadable controller
    const saveAsNewTestset = useSetAtom(loadableController.actions.saveAsNewTestset)

    const saveTestset = useCallback(
        async (commitMessage?: string): Promise<TestsetSavePayload | null> => {
            setIsSaving(true)
            setError(null)

            try {
                // Use the loadable controller's save action
                const result = await saveAsNewTestset(loadableId, commitMessage)

                if (!result.success) {
                    throw result.error || new Error("Failed to save testset")
                }

                // Validate required fields are present after successful save
                if (!result.revisionId || !result.testsetId) {
                    throw new Error("Save succeeded but missing required IDs in response")
                }

                const payload: TestsetSavePayload = {
                    testsetName: name || "",
                    revisionId: result.revisionId,
                    testsetId: result.testsetId,
                }

                onSuccess?.(payload)
                return payload
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err))
                setError(error)
                onError?.(error)
                message.error(`Failed to save testset: ${error.message}`)
                return null
            } finally {
                setIsSaving(false)
            }
        },
        [loadableId, name, saveAsNewTestset, onSuccess, onError],
    )

    return {
        saveTestset,
        isSaving,
        error,
    }
}
