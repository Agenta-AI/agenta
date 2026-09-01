import {useEffect, useState} from "react"

import type {StagedUpload as UploadFile} from "@agenta/chat/model"
import {atom, useAtom} from "jotai"

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
 * Previews a SENT attachment in the same Files drawer the composer tray uses.
 *
 * The drawer reads local blobs, and a replayed attachment is a URL — so this fetches it once on
 * open and hands the drawer a synthesized staged row. Mounted once by the conversation; cards set
 * the atom rather than each owning a drawer.
 */
const MessageAttachmentViewer = () => {
    const [viewing, setViewing] = useAtom(viewingMessageAttachmentAtom)
    const [uploads, setUploads] = useState<UploadFile[]>([])

    useEffect(() => {
        if (!viewing) {
            setUploads([])
            return
        }
        let cancelled = false
        void (async () => {
            try {
                const response = await fetch(viewing.url, {credentials: "include"})
                if (!response.ok) throw new Error("Attachment fetch failed")
                const blob = await response.blob()
                if (cancelled) return
                const file = new File([blob], viewing.name, {
                    type: viewing.mediaType || blob.type,
                })
                setUploads([{uid: viewing.url, name: viewing.name, originFileObj: file}])
            } catch {
                // Nothing to preview — close rather than leave an empty drawer open.
                if (!cancelled) setViewing(null)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [viewing, setViewing])

    return (
        <AttachmentViewerDrawer
            uploads={uploads}
            openUid={viewing && uploads.length > 0 ? uploads[0].uid : null}
            onClose={() => setViewing(null)}
        />
    )
}

export default MessageAttachmentViewer
