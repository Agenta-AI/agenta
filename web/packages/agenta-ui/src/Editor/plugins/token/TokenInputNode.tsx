import {LexicalNode, TextNode, SerializedTextNode} from "lexical"

export type SerializedTokenInputNode = SerializedTextNode & {
    type: "tokeninput"
    version: 1
}

export class TokenInputNode extends TextNode {
    static getType() {
        return "tokeninput"
    }

    static clone(node: TokenInputNode) {
        return new TokenInputNode(node.__text, node.__key)
    }

    createDOM(): HTMLElement {
        const dom = document.createElement("span")
        dom.className = "token-input-node"
        dom.textContent = this.__text
        dom.style.backgroundColor = "#f0e68c"
        dom.style.padding = "0 4px"
        dom.style.borderRadius = "4px"
        dom.style.border = "1px dashed #d3d3d3"
        return dom
    }

    updateDOM(prevNode: TokenInputNode, dom: HTMLElement) {
        if (prevNode.__text !== this.__text) {
            dom.className = "token-input-node"
            dom.textContent = this.__text
            return true
        }
        return false
    }

    exportJSON(): SerializedTokenInputNode {
        return {
            ...super.exportJSON(),
            type: "tokeninput",
            version: 1,
        }
    }

    static importJSON(serializedNode: SerializedTokenInputNode): TokenInputNode {
        const node = $createTokenInputNode(serializedNode.text)
        node.setFormat(serializedNode.format)
        node.setDetail(serializedNode.detail)
        node.setMode(serializedNode.mode)
        node.setStyle(serializedNode.style)
        return node
    }
}

export function $createTokenInputNode(text: string) {
    return new TokenInputNode(text)
}

export function $isTokenInputNode(node: LexicalNode | null | undefined): node is TokenInputNode {
    return node instanceof TokenInputNode
}
