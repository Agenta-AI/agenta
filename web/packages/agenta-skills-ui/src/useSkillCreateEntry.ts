import {useCallback, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"

/** `SkillCreateDrawer`'s host state; Write clears the upload so the editor opens blank. */
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
