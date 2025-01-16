/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import {LexicalEditor, TextNode} from "lexical"
import {Tokenizer} from "./types"
import {$isCodeNode} from "../../CodeNode"
import {$isCodeLineNode} from "../../CodeLineNode"
import {codeNodeTransform} from "./codeNodeTransform"

export function $textNodeTransform(
    node: TextNode,
    editor: LexicalEditor,
    tokenizer: Tokenizer,
): void {
    const parent = node.getParent()
    if (!$isCodeLineNode(parent)) {
        return
    }

    const grandparent = parent.getParent()
    if (!$isCodeNode(grandparent)) {
        return
    }

    codeNodeTransform(grandparent, editor, tokenizer)
}
