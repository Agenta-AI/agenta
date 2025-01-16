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
