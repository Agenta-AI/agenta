import type {CodeLanguage} from "../../types"

export interface CodeModelSnapshot {
    editorId: string
    content: string
    language: CodeLanguage
    timestamp: number
}

export interface CodeModelOutput {
    getSnapshot: () => CodeModelSnapshot
    subscribe: (listener: () => void) => () => void
    setSnapshot: (snapshot: CodeModelSnapshot) => void
}
