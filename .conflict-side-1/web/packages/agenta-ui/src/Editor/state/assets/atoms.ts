import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

// Single atom instance that will be scoped by the provider
export const editorStateAtom = atomWithStorage("editor-state", "")

export const markdownViewAtom = atomFamily((id: string) =>
    atomWithStorage(`markdown-view-${id}`, false),
)
