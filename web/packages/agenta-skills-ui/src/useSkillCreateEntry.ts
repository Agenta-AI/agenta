import {useCallback, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"

/**
 * The state a host keeps for `SkillCreateDrawer`: whether it is open, and the upload it opens
 * on. Write and Upload share the drawer; Write clears the upload so the editor opens blank.
 * Hands `onWrite` / `onUpload` to `NewSkillMenuButton` and `createOpen` / `upload` / `closeCreate`
 * to the drawer.
 */
export const useSkillCreateEntry = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [upload, setUpload] = useState<Promise<SkillUploadScan> | null>(null)
    const onWrite = useCallback(() => {
        setUpload(null)
        setCreateOpen(true)
    }, [])
    const onUpload = useCallback((scan: Promise<SkillUploadScan>) => {
        setUpload(scan)
        setCreateOpen(true)
    }, [])
    const closeCreate = useCallback(() => setCreateOpen(false), [])
    return {createOpen, upload, onWrite, onUpload, closeCreate}
}
