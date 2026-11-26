import type {Folder} from "@agenta/entities/workflow"

import type {PromptItem} from "./promptRow"

/** The one dialog that is open on the Prompts page, and what it is about. */
export type PromptsDialog =
    | {kind: "newFolder"}
    | {kind: "renameFolder"; folder: Folder}
    | {kind: "moveFolder"; folder: Folder}
    | {kind: "deleteFolder"; folder: Folder}
    | {kind: "renamePrompt"; prompt: PromptItem}
    | {kind: "movePrompt"; prompt: PromptItem}
    | {kind: "archivePrompt"; prompt: PromptItem}
