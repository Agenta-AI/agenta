/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * This file is adapted from Meta's Lexical project:
 * https://github.com/facebook/lexical
 */

import type {LexicalEditor} from "lexical"

import {$isCodeLineNode} from "../../CodeLineNode"
import {CodeNode} from "../../CodeNode"

export function updateCodeGutter(node: CodeNode, editor: LexicalEditor): void {
    const codeElement = editor.getElementByKey(node.getKey())
    if (codeElement === null) {
        return
    }
    const children = node.getChildren()?.filter($isCodeLineNode)
    const childrenLength = children.length

    let gutter = "1"
    let count = 1
    for (let i = 1; i < childrenLength; i++) {
        const child = children[i]
        if (!child.isHidden()) {
            gutter += "\n" + ++count
        } else {
            ++count
        }
    }

    codeElement.setAttribute("data-gutter", gutter)
}
