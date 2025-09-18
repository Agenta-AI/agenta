import {atomFamily, atomWithStorage} from "jotai/utils"

// Single atom instance that will be scoped by the provider
export const editorStateAtom = atomWithStorage("editor-state", "")

export const markdownViewAtom = atomFamily((id: string) =>
    atomWithStorage(`markdown-view-${id}`, false),
)
