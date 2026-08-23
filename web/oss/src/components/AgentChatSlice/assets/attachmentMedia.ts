import {useEffect, useMemo, useState} from "react"

import {attachmentContentUrl} from "@agenta/chat/assets"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"

export async function fetchAttachmentBlob({
    sessionId,
    attachmentId,
}: {
    sessionId: string
    attachmentId: string
}): Promise<Blob | null> {
    if (!sessionId || !attachmentId) return null
    try {
        // Axios (not Fern): Fern JSON-parses response bodies, mangling binary payloads.
        const response = await axios.get(attachmentContentUrl(sessionId, attachmentId), {
            responseType: "blob",
        })
        return response.data as Blob
    } catch {
        return null
    }
}

/** Attachment blobs are dropped as soon as the last renderer unmounts. */
export const attachmentBlobQueryFamily = atomFamily(
    ({sessionId, attachmentId}: {sessionId: string; attachmentId: string}) =>
        atomWithQuery<Blob | null>(() => ({
            queryKey: ["sessions", "attachment-blob", sessionId, attachmentId],
            queryFn: () => fetchAttachmentBlob({sessionId, attachmentId}),
            enabled: Boolean(sessionId && attachmentId),
            staleTime: Infinity,
            gcTime: 0,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.sessionId === b.sessionId && a.attachmentId === b.attachmentId,
)

export function useAttachmentObjectUrl(
    sessionId: string | null | undefined,
    attachmentId: string | null | undefined,
): {url: string | null; isPending: boolean; failed: boolean} {
    const query = useAtomValue(
        attachmentBlobQueryFamily({sessionId: sessionId ?? "", attachmentId: attachmentId ?? ""}),
    )
    const blob = query.data ?? null
    const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
    useEffect(() => {
        return () => {
            if (url) URL.revokeObjectURL(url)
        }
    }, [url])
    return {url, isPending: query.isPending, failed: !query.isPending && !blob}
}

/** Try the direct content URL first, then fall back to an authenticated axios blob. */
export function useAttachmentMediaSrc(
    sessionId: string | null | undefined,
    attachmentId: string | null | undefined,
): {src: string | null; isPending: boolean; failed: boolean; onError: () => void} {
    const directUrl =
        sessionId && attachmentId ? attachmentContentUrl(sessionId, attachmentId) : null
    const [mode, setMode] = useState<"direct" | "blob">(directUrl ? "direct" : "blob")

    useEffect(() => {
        setMode(directUrl ? "direct" : "blob")
    }, [directUrl])

    const blobQuery = useAtomValue(
        attachmentBlobQueryFamily({
            sessionId: mode === "blob" ? (sessionId ?? "") : "",
            attachmentId: mode === "blob" ? (attachmentId ?? "") : "",
        }),
    )
    const blob = mode === "blob" ? (blobQuery.data ?? null) : null
    const blobUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
    useEffect(() => {
        return () => {
            if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
    }, [blobUrl])

    return {
        src: mode === "direct" ? directUrl : blobUrl,
        isPending: mode === "blob" && blobQuery.isPending,
        failed: mode === "blob" && !blobQuery.isPending && !blob,
        onError: () => setMode("blob"),
    }
}
