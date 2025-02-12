import {TextNode, SerializedTextNode, $createTextNode, NodeKey, LexicalNode} from "lexical"

export type SerializedTokenNode = SerializedTextNode & {
    type: "token"
    version: 1
}

export class TokenNode extends TextNode {
    static getType(): string {
        return "token"
    }

    static clone(node: TokenNode): TokenNode {
        return new TokenNode(node.__text, node.__key)
    }

    constructor(text: string, key?: NodeKey) {
        super(text, key)
    }

    createDOM(): HTMLElement {
        const dom = document.createElement("span")
        dom.classList.add("token-node")
        dom.textContent = this.__text
        dom.style.backgroundColor = "#e2e8f0"
        dom.style.color = "#1677FF"
        dom.style.padding = "0 4px"
        dom.style.borderRadius = "4px"
        return dom
    }

    updateDOM(_prevNode: TokenNode, dom: HTMLElement): boolean {
        const text = this.getTextContent()
        if (text !== dom.textContent) {
            dom.textContent = text
            return true
        }
        return false
    }

    exportJSON(): SerializedTokenNode {
        return {
            ...super.exportJSON(),
            type: "token",
            version: 1,
        }
    }

    static importJSON(serializedNode: SerializedTokenNode): TokenNode {
        const node = $createTokenNode(serializedNode.text)
        node.setFormat(serializedNode.format)
        node.setDetail(serializedNode.detail)
        node.setMode(serializedNode.mode)
        node.setStyle(serializedNode.style)
        return node
    }

    // Convert to regular text node if no longer valid token
    isValid(): boolean {
        return /^\{\{[^{}]+\}\}$/.test(this.__text)
    }

    remove(): void {
        if (!this.isValid()) {
            const textNode = $createTextNode(this.__text)
            this.replace(textNode)
        } else {
            super.remove()
        }
    }
}

export function $createTokenNode(text: string): TokenNode {
    return new TokenNode(text)
}

export function $isTokenNode(node: LexicalNode | null | undefined): node is TokenNode {
    return node instanceof TokenNode
}
