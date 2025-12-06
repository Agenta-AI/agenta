import {atom} from "jotai"

import {getProjectValues} from "@/oss/state/project"

export const activePreviewRunIdAtom = atom<string | null>(null)
export const activePreviewProjectIdAtom = atom<string | null>(null)

export const effectiveProjectIdAtom = atom((get) => {
    const previewProjectId = get(activePreviewProjectIdAtom)
    if (previewProjectId) {
        return previewProjectId
    }
    const {projectId: globalProjectId} = getProjectValues()
    return globalProjectId
})
