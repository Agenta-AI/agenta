import {useMemo} from "react"

import {isViewable} from "@agenta/chat/assets"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import {mediaViewerAtom, type MediaViewerItem} from "@agenta/entity-ui/drive"
import {useSetAtom} from "jotai"

/** Opens a staged composer file in the app's media viewer, paging through the tray's viewable
 * files. Pass the result as the composer's `onViewAttachment`. */
export function useStagedAttachmentViewer(
    attachments: ReturnType<typeof useComposerAttachments>,
): (uid: string) => void {
    const {files} = attachments
    const openViewer = useSetAtom(mediaViewerAtom)
    const items = useMemo(
        () =>
            files.flatMap((staged): MediaViewerItem[] => {
                const file = staged.originFileObj
                if (!file || !isViewable(file.type)) return []
                return [
                    {
                        key: staged.uid,
                        name: staged.name,
                        mediaType: file.type,
                        size: file.size,
                        source: {kind: "file", file},
                    },
                ]
            }),
        [files],
    )
    return (uid) => {
        const index = items.findIndex((item) => item.key === uid)
        if (index >= 0) openViewer({items, index})
    }
}
