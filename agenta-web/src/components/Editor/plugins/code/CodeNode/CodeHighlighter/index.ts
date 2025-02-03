/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {LexicalEditor} from "lexical"

import {mergeRegister} from "@lexical/utils"
import {
    $createTabNode,
    $getNodeByKey,
    $getSelection,
    $insertNodes,
    COMMAND_PRIORITY_LOW,
    INDENT_CONTENT_COMMAND,
    INSERT_TAB_COMMAND,
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_TAB_COMMAND,
    MOVE_TO_END,
    MOVE_TO_START,
    OUTDENT_CONTENT_COMMAND,
    TextNode,
} from "lexical"

import {CodeHighlightNode} from "../CodeHighlightNode"
import {CodeNode} from "../CodeNode"
import {Tokenizer} from "./utils/types"
import {CodeLineNode} from "../CodeLineNode"
import {
    $handleMoveTo,
    $handleMultilineIndent,
    $handleShiftLines,
    $handleTab,
} from "./utils/handlers"
import {$isSelectionInCode} from "./utils/selection"
import {$textNodeTransform} from "./utils/textTransform"
import {codeNodeTransform} from "./utils/codeNodeTransform"
import {PrismTokenizer} from "./utils/tokenizer"
import {updateCodeGutter} from "./utils/gutter"

// Using `skipTransforms` to prevent extra transforms since reformatting the code
// will not affect code block content itself.
//
// Using extra cache (`nodesCurrentlyHighlighting`) since both CodeNode and CodeHighlightNode
// transforms might be called at the same time (e.g. new CodeHighlight node inserted) and
// in both cases we'll rerun whole reformatting over CodeNode, which is redundant.
// Especially when pasting code into CodeBlock.

export function registerCodeHighlighting(editor: LexicalEditor, tokenizer?: Tokenizer): () => void {
    if (!editor.hasNodes([CodeNode, CodeHighlightNode, CodeLineNode])) {
        throw new Error(
            "CodeHighlightPlugin: CodeNode or CodeHighlightNode not registered on editor",
        )
    }

    if (tokenizer == null) {
        tokenizer = PrismTokenizer
    }

    return mergeRegister(
        editor.registerMutationListener(
            CodeNode,
            (mutations) => {
                editor.update(() => {
                    for (const [key, type] of mutations) {
                        if (type !== "destroyed") {
                            const node = $getNodeByKey(key)
                            if (node !== null) {
                                updateCodeGutter(node as CodeNode, editor)
                            }
                        }
                    }
                })
            },
            {skipInitialization: false},
        ),
        editor.registerNodeTransform(CodeNode, (node) =>
            codeNodeTransform(node, editor, tokenizer as Tokenizer),
        ),
        editor.registerNodeTransform(TextNode, (node) =>
            $textNodeTransform(node, editor, tokenizer as Tokenizer),
        ),
        editor.registerNodeTransform(CodeHighlightNode, (node) =>
            $textNodeTransform(node, editor, tokenizer as Tokenizer),
        ),
        editor.registerCommand(
            KEY_TAB_COMMAND,
            (event) => {
                const command = $handleTab(event.shiftKey)
                if (command === null) {
                    return false
                }
                event.preventDefault()
                editor.dispatchCommand(command, undefined)
                return true
            },
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            INSERT_TAB_COMMAND,
            () => {
                const selection = $getSelection()
                if (!$isSelectionInCode(selection)) {
                    return false
                }
                $insertNodes([$createTabNode()])
                return true
            },
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            INDENT_CONTENT_COMMAND,
            (): boolean => $handleMultilineIndent(INDENT_CONTENT_COMMAND),
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            OUTDENT_CONTENT_COMMAND,
            (): boolean => $handleMultilineIndent(OUTDENT_CONTENT_COMMAND),
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            KEY_ARROW_UP_COMMAND,
            (payload): boolean => $handleShiftLines(KEY_ARROW_UP_COMMAND, payload),
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            KEY_ARROW_DOWN_COMMAND,
            (payload): boolean => $handleShiftLines(KEY_ARROW_DOWN_COMMAND, payload),
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            MOVE_TO_END,
            (payload): boolean => $handleMoveTo(MOVE_TO_END, payload),
            COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
            MOVE_TO_START,
            (payload): boolean => $handleMoveTo(MOVE_TO_START, payload),
            COMMAND_PRIORITY_LOW,
        ),
    )
}
