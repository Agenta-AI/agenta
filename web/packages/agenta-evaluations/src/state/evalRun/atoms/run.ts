import {projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"

export const activePreviewRunIdAtom = atom<string | null>(null)
export const activePreviewProjectIdAtom = atom<string | null>(null)

export const effectiveProjectIdAtom = atom((get) => {
    const previewProjectId = get(activePreviewProjectIdAtom)
    if (previewProjectId) {
        return previewProjectId
    }
    const globalProjectId = getDefaultStore().get(projectIdAtom)
    return globalProjectId
})
