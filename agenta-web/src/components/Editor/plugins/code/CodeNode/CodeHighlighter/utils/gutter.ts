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
