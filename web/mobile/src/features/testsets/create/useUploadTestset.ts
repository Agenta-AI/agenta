import {useCallback, useState} from "react"

import {uploadTestsetFile, type TestsetFileType} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {refreshTestsetLists} from "./refreshTestsetLists"
import {uploadFailureMessage} from "./uploadFailure"

export const UPLOAD_FAILED = "Couldn't create the test set from this file"

/** A test set the upload made, with the name the reader typed. */
export interface CreatedTestset {
    testsetId: string
    revisionId: string | null
    name: string
}

/**
 * Create a test set from a file that already passed the check. A server refusal turns into
 * plain words for the reader; the server's text goes to the console only.
 */
export function useUploadTestset({
    projectId,
    base,
    onDone,
    onCreated,
}: {
    projectId: string
    base: string
    onDone: () => void
    /** Replaces the jump to the new test set page. The dialog stays open until it settles. */
    onCreated?: (created: CreatedTestset) => void | Promise<void>
}) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const upload = useCallback(
        async ({file, fileType, name}: {file: File; fileType: TestsetFileType; name: string}) => {
            const testsetName = name.trim()
            if (!testsetName) return
            setPending(true)
            setError(null)
            try {
                let created: Awaited<ReturnType<typeof uploadTestsetFile>>
                try {
                    created = await uploadTestsetFile({
                        projectId,
                        file,
                        fileType,
                        testsetName,
                    })
                } catch (cause) {
                    console.error("Creating a test set from a file failed", cause)
                    setError(uploadFailureMessage(cause, fileType, UPLOAD_FAILED))
                    return
                }
                message.success("Test set uploaded successfully")
                void refreshTestsetLists(queryClient)
                if (onCreated) {
                    await onCreated({
                        testsetId: created.testsetId,
                        revisionId: created.revisionId,
                        name: testsetName,
                    })
                } else if (created.revisionId) {
                    void router.push(`${base}/testsets/${created.revisionId}`)
                }
                onDone()
            } finally {
                setPending(false)
            }
        },
        [base, onCreated, onDone, projectId, queryClient, router],
    )

    const clearError = useCallback(() => setError(null), [])

    return {upload, pending, error, clearError}
}
