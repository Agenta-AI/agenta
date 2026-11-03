import type {Folder, FolderTreeNode, Workflow} from "@agenta/entities/workflow"

/** A prompt as the list needs it: the list flags decide the type, so no row asks for a revision. */
export interface PromptItem extends Workflow {
    type: "chat" | "completion" | "custom"
}

/** One line of the list: a folder or a prompt, and how deep it sits in a search tree. */
export type PromptsRow =
    | {key: string; kind: "folder"; depth: number; folder: Folder}
    | {key: string; kind: "prompt"; depth: number; prompt: PromptItem}

export const promptType = (flags: Workflow["flags"]): PromptItem["type"] => {
    if (flags?.is_custom) return "custom"
    if (flags?.is_chat) return "chat"
    return "completion"
}

/** Walks the tree top down, so a search result reads as the folders it sits in. */
export const flattenTree = (
    nodes: readonly FolderTreeNode<PromptItem>[],
    depth = 0,
): PromptsRow[] =>
    nodes.flatMap((node): PromptsRow[] =>
        node.kind === "prompt"
            ? [{key: node.id, kind: "prompt", depth, prompt: node.prompt}]
            : [
                  {key: node.id, kind: "folder", depth, folder: node.folder},
                  ...flattenTree(node.children, depth + 1),
              ],
    )
