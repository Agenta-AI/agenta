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
        const text = this.__text
        dom.textContent = text
        // Base styles
        dom.style.padding = "0 4px"
        dom.style.borderRadius = "4px"
        dom.style.backgroundColor = "#e2e8f0"
        // Color by token type
        if (text.startsWith("{#")) {
            // Jinja comment -> grey
            dom.style.color = "#6b7280" // gray-500
        } else if (text.startsWith("{%")) {
            // Jinja block -> distinct color (purple)
            dom.style.color = "#a855f7" // purple-500
        } else {
            // Default variable token {{ }}
            dom.style.color = "#1677FF"
        }
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
        // Accept curly tokens and Jinja2 block/comment/variable tokens
        return /^(\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\})$/.test(
            this.__text,
        )
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
