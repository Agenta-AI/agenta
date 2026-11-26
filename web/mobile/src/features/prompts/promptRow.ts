import type {Folder, FolderTreeNode, Workflow} from "@agenta/entities/workflow"

/** A prompt in the list. Its type comes from its latest revision, as in /w. */
export type PromptItem = Workflow

/** One line of the list: a folder or a prompt, and how deep it sits in a search tree. */
export type PromptsRow =
    | {key: string; kind: "folder"; depth: number; folder: Folder}
    | {key: string; kind: "prompt"; depth: number; prompt: PromptItem}

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
