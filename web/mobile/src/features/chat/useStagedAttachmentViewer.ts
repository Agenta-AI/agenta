import {useMemo} from "react"

import {isViewable} from "@agenta/chat/assets"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import type {MediaViewerItem, MediaViewerProps} from "@agenta/entity-ui/drive"

/** The composer tray's viewable files as media-viewer items, opened by the tray's `viewingUid`. */
export function useStagedAttachmentViewer(
    attachments: ReturnType<typeof useComposerAttachments>,
): MediaViewerProps {
    const {files, viewingUid, setViewingUid} = attachments
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
    const index = items.findIndex((item) => item.key === viewingUid)
    return {
        items,
        index: index < 0 ? null : index,
        onIndexChange: (next) => setViewingUid(next === null ? null : (items[next]?.key ?? null)),
    }
}
