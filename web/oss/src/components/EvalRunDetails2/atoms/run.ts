import {atom} from "jotai"
import {projectIdAtom} from "@/oss/state/project"

export const activePreviewRunIdAtom = atom<string | null>(null)
export const activePreviewProjectIdAtom = atom<string | null>(null)

export const effectiveProjectIdAtom = atom((get) => {
    const previewProjectId = get(activePreviewProjectIdAtom)
    if (previewProjectId) {
        return previewProjectId
    }
    return get(projectIdAtom)
})
