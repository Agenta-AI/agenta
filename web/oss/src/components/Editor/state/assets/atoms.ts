import {atomWithStorage} from "jotai/utils"

// Single atom instance that will be scoped by the provider
export const editorStateAtom = atomWithStorage("editor-state", "")

export const markdownViewAtom = atomWithStorage("markdown-view", false)
