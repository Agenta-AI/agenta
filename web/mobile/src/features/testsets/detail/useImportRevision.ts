import {useCallback, useState} from "react"

import {
    invalidateRevisionsListCache,
    invalidateTestsetCache,
    uploadTestsetRevisionFile,
    type TestsetFileType,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

import {refreshTestsetLists} from "../create/refreshTestsetLists"
import {uploadFailureMessage} from "../create/uploadFailure"

export const IMPORT_FAILED = "Couldn't import this file"

/**
 * Save a checked file as a new revision of a test set. The server replaces every row with the
 * rows of the file. A refusal turns into plain words for the reader; the server's text goes to
 * the console only.
 */
export function useImportRevision({
    projectId,
    testsetId,
    onImported,
}: {
    projectId: string
    testsetId: string
    /** Gets the new revision id, or null when the server did not return one. */
    onImported: (revisionId: string | null) => void
}) {
    const queryClient = useQueryClient()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const importFile = useCallback(
        async ({file, fileType}: {file: File; fileType: TestsetFileType}) => {
            setPending(true)
            setError(null)
            try {
                let imported: Awaited<ReturnType<typeof uploadTestsetRevisionFile>>
                try {
                    imported = await uploadTestsetRevisionFile({
                        projectId,
                        testsetId,
                        file,
                        fileType,
                    })
                } catch (cause) {
                    console.error("Importing a file as a new revision failed", cause)
                    setError(uploadFailureMessage(cause, fileType, IMPORT_FAILED))
                    return
                }
                message.success("File imported successfully as new revision")
                invalidateTestsetCache(testsetId)
                invalidateRevisionsListCache(testsetId)
                void refreshTestsetLists(queryClient)
                onImported(imported.revisionId)
            } finally {
                setPending(false)
            }
        },
        [onImported, projectId, queryClient, testsetId],
    )

    const clearError = useCallback(() => setError(null), [])

    return {importFile, pending, error, clearError}
}
