import type {PromptsRow} from "./promptRow"

/** What a row's menu can ask the screen to do. */
export interface PromptRowActions {
    openFolder: (row: Extract<PromptsRow, {kind: "folder"}>) => void
    /** Opens the prompt in the playground; null while the playground view is off. */
    openPrompt: ((row: Extract<PromptsRow, {kind: "prompt"}>) => void) | null
    rename: (row: PromptsRow) => void
    move: (row: PromptsRow) => void
    /** Delete for a folder, Archive for a prompt. */
    remove: (row: PromptsRow) => void
}
