import {useEffect, useMemo} from "react"

import type {StagedUpload as UploadFile} from "@agenta/chat/model"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import AttachmentViewerDrawer from "./AttachmentViewerDrawer"

/** The sent attachment a transcript card asked to preview, or null when the drawer is closed. */
export interface ViewingMessageAttachment {
    name: string
    mediaType: string
    /** The durable content endpoint; fetched with credentials into a blob for the drawer. */
    url: string
}

export const viewingMessageAttachmentAtom = atom<ViewingMessageAttachment | null>(null)

/**
 * The selected attachment as a `File`. Keyed on the URL, so the blob can only ever belong to the
 * current selection — switching attachments cannot leave the previous one on screen.
 */
const attachmentFileAtom = atomWithQuery((get) => {
    const viewing = get(viewingMessageAttachmentAtom)
    return {
        queryKey: ["message-attachment", viewing?.url ?? null],
        queryFn: async (): Promise<File | null> => {
            if (!viewing) return null
            const response = await fetch(viewing.url, {credentials: "include"})
            if (!response.ok) throw new Error("Attachment fetch failed")
            const blob = await response.blob()
            return new File([blob], viewing.name, {type: viewing.mediaType || blob.type})
        },
        enabled: !!viewing,
        staleTime: 5 * 60_000,
    }
})

/**
 * Previews a SENT attachment in the same Files drawer the composer tray uses.
 *
 * The drawer reads local blobs and a replayed attachment is a URL, so the bytes are fetched once
 * and handed over as a synthesized staged row. Mounted once by the conversation; cards set the
 * atom rather than each owning a drawer.
 */
const MessageAttachmentViewer = () => {
    const [viewing, setViewing] = useAtom(viewingMessageAttachmentAtom)
    const {data: file, isError} = useAtomValue(attachmentFileAtom)

    // Nothing to preview — close rather than leave an empty drawer open.
    useEffect(() => {
        if (isError) setViewing(null)
    }, [isError, setViewing])

    const uploads = useMemo<UploadFile[]>(
        () =>
            viewing && file ? [{uid: viewing.url, name: viewing.name, originFileObj: file}] : [],
        [viewing, file],
    )

    return (
        <AttachmentViewerDrawer
            uploads={uploads}
            openUid={uploads[0]?.uid ?? null}
            onClose={() => setViewing(null)}
        />
    )
}

export default MessageAttachmentViewer
