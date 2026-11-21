import {useCallback, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"

import type {NewSkillStep} from "./NewSkillBody"

/** `SkillCreateDrawer`'s host state: which way the page menu picked, and the upload being read. */
export const useSkillCreateEntry = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [upload, setUpload] = useState<Promise<SkillUploadScan> | null>(null)
    const [start, setStart] = useState<NewSkillStep>("write")
    const open = useCallback((step: NewSkillStep, scan: Promise<SkillUploadScan> | null) => {
        setStart(step)
        setUpload(scan)
        setCreateOpen(true)
    }, [])
    const onWrite = useCallback(() => open("write", null), [open])
    const onUpload = useCallback((scan: Promise<SkillUploadScan>) => open("upload", scan), [open])
    const onImport = useCallback(() => open("import", null), [open])
    const closeCreate = useCallback(() => setCreateOpen(false), [])
    return {createOpen, upload, start, onWrite, onUpload, onImport, closeCreate}
}
