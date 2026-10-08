import {useMemo} from "react"

import {mediaViewerAtom, type MediaViewerItem} from "@agenta/entity-ui/drive"
import {useSetAtom} from "jotai"

import {isViewable} from "../assets/attachmentRules"
import type {StagedUpload} from "../model"

/** Opens a staged file in the app's media viewer, paging through the tray's viewable files. */
export function useStagedFilesViewer(files: StagedUpload[]): (uid: string) => void {
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
