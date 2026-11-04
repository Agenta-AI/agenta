import {useCallback} from "react"

import {cloneTestset, invalidateTestsetCache, updateTestsetMetadata} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {refreshTestsetLists} from "./refreshTestsetLists"

export const CLONE_FAILED = "Failed to clone the test set. Please try again."
export const RENAME_FAILED = "Failed to rename the test set. Please try again."

/** What an action needs of a row. */
interface TestsetRef {
    id: string
}

/**
 * Clone and rename a test set. Each throws an `Error` with a plain message when it fails, so the
 * dialog can show the text and stay open. The server's own text goes to the console only.
 */
export function useTestsetNameActions({projectId, base}: {projectId: string; base: string}) {
    const router = useRouter()
    const queryClient = useQueryClient()

    const clone = useCallback(
        async (source: TestsetRef, newName: string): Promise<void> => {
            let created: Awaited<ReturnType<typeof cloneTestset>>
            try {
                created = await cloneTestset({projectId, sourceTestsetId: source.id, newName})
            } catch (cause) {
                console.error("Cloning a test set failed", cause)
                throw new Error(CLONE_FAILED)
            }
            message.success("Test set cloned successfully")
            void refreshTestsetLists(queryClient)
            const target = created?.revisionId ?? created?.testset?.id
            if (target) void router.push(`${base}/testsets/${target}`)
        },
        [base, projectId, queryClient, router],
    )

    const rename = useCallback(
        async (source: TestsetRef, name: string): Promise<void> => {
            try {
                await updateTestsetMetadata({projectId, testsetId: source.id, name})
            } catch (cause) {
                console.error("Renaming a test set failed", cause)
                throw new Error(RENAME_FAILED)
            }
            message.success("Test set renamed successfully")
            invalidateTestsetCache(source.id)
            void refreshTestsetLists(queryClient)
        },
        [projectId, queryClient],
    )

    return {clone, rename}
}
