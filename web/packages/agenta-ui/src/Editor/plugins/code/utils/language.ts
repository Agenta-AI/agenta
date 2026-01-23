import {$getRoot, LexicalEditor} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import type {CodeLanguage} from "../types"
import {DEFAULT_CODE_LANGUAGE} from "../types"

/**
 * Determines the active language mode of the code editor.
 *
 * Searches through the editor's root node to find the first CodeBlockNode
 * and returns its language setting. This is used to determine which parser
 * to use for validation and syntax highlighting.
 *
 * @param editor - The Lexical editor instance to check
 * @returns The current language mode, defaults to 'json' if no code block found
 */
export function $getActiveLanguage(editor: LexicalEditor): CodeLanguage {
    const root = $getRoot()
    for (const block of root.getChildren()) {
        if ($isCodeBlockNode(block)) {
            return block.getLanguage()
        }
    }
    return DEFAULT_CODE_LANGUAGE
}
