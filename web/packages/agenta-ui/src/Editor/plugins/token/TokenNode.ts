import {extractTemplateExpression, validateTemplateVariable} from "@agenta/shared/utils"
import {TextNode, SerializedTextNode, $createTextNode, NodeKey, LexicalNode} from "lexical"

export type SerializedTokenNode = SerializedTextNode & {
    type: "token"
    version: 1
}

/**
 * Apply visual styles to the token's DOM element.
 *
 * Shared between `createDOM` (mount) and `updateDOM` (text change) so that
 * editing a placeholder — e.g. typing `$.inputs` → `$.input` — re-evaluates
 * semantic validity and re-paints the token in real time. Without this,
 * validity checked only at mount would leave stale styling behind.
 */
function applyTokenStyles(dom: HTMLElement, text: string): void {
    dom.style.padding = "0 4px"
    dom.style.borderRadius = "4px"
    // Clear any previous invalid marker — re-set below only when invalid.
    dom.removeAttribute("data-invalid")
    dom.removeAttribute("data-tooltip")
    dom.removeAttribute("data-tooltip-suggestion")

    if (text.startsWith("{#")) {
        // Jinja comment — grey
        dom.style.backgroundColor = "#e2e8f0"
        dom.style.color = "#6b7280"
        dom.style.border = ""
        return
    }
    if (text.startsWith("{%")) {
        // Jinja block — purple
        dom.style.backgroundColor = "#e2e8f0"
        dom.style.color = "#a855f7"
        dom.style.border = ""
        return
    }

    // Variable token `{{ expr }}` — check whether `expr` routes to a known
    // envelope slot. Paths like `$.input.xx.abc` (typo of `$.inputs.*`) are
    // structurally invalid; paint them with an error state so the user sees
    // the problem at the source instead of silently getting no input.
    //
    // Tooltip content is published on data-* attributes; a React overlay
    // (TokenTooltipPlugin) reads them on hover and renders an Ant Tooltip.
    const expr = extractTemplateExpression(text)
    const result = validateTemplateVariable(expr)

    if (result.valid) {
        dom.style.backgroundColor = "#e2e8f0"
        dom.style.color = "#1677FF"
        dom.style.border = ""
    } else {
        dom.style.backgroundColor = "#FEF2F2" // red-50
        dom.style.color = "#B91C1C" // red-700
        dom.style.border = "1px dashed #F87171" // red-400
        dom.setAttribute("data-invalid", "true")
        dom.setAttribute("data-tooltip", result.reason ?? "Invalid template placeholder.")
        if (result.suggestion) {
            dom.setAttribute("data-tooltip-suggestion", result.suggestion)
        }
    }
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
        applyTokenStyles(dom, this.__text)
        return dom
    }

    updateDOM(_prevNode: TokenNode, dom: HTMLElement): boolean {
        const text = this.getTextContent()
        const textChanged = text !== dom.textContent
        if (textChanged) dom.textContent = text
        // Re-apply styles even when text didn't change at this exact node —
        // edits to a nearby path segment can change validity without
        // changing this node's own text, but when it DOES change we also
        // need to re-evaluate because the new text may be valid/invalid.
        applyTokenStyles(dom, text)
        return textChanged
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
