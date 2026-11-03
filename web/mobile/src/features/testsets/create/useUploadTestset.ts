import {useCallback, useState} from "react"

import {uploadTestsetFile, type TestsetFileType} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {refreshTestsetLists} from "./refreshTestsetLists"

export const UPLOAD_FAILED = "Couldn't create the test set from this file"

const malformedMessage = (fileType: TestsetFileType): string =>
    `The file you uploaded is either malformed or is not a valid ${fileType.toUpperCase()} file`

/**
 * The server answers 400 "Failed to read ... file" when it cannot parse the file. An older
 * path answers 422 with `csvdata` in the detail. Both mean the file is malformed.
 */
const isMalformedFile = (error: unknown): boolean => {
    const {statusCode, body} = error as {statusCode?: number; body?: {detail?: unknown}}
    const detail = JSON.stringify(body?.detail ?? "")
    if (statusCode === 400) return detail.includes("Failed to read")
    return statusCode === 422 && detail.includes("csvdata")
}

/**
 * Create a test set from a file that already passed the check. A server refusal turns into
 * plain words for the reader; the server's text goes to the console only.
 */
export function useUploadTestset({
    projectId,
    base,
    onDone,
}: {
    projectId: string
    base: string
    onDone: () => void
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
                    setError(isMalformedFile(cause) ? malformedMessage(fileType) : UPLOAD_FAILED)
                    return
                }
                message.success("Test set uploaded successfully")
                void refreshTestsetLists(queryClient)
                if (created.revisionId) void router.push(`${base}/testsets/${created.revisionId}`)
                onDone()
            } finally {
                setPending(false)
            }
        },
        [base, onDone, projectId, queryClient, router],
    )

    return {upload, pending, error}
}
