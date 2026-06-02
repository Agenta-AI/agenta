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
        dom.style.backgroundColor = "var(--ag-c-E2E8F0)"
        dom.style.color = "var(--ag-c-6B7280)"
        dom.style.border = ""
        return
    }
    if (text.startsWith("{%")) {
        // Jinja block — purple
        dom.style.backgroundColor = "var(--ag-c-E2E8F0)"
        dom.style.color = "var(--ag-c-A855F7)"
        dom.style.border = ""
        return
    }

    // Variable token `{{ expr }}` — validate the inner expression. Only
    // structurally malformed expressions get the error paint now (empty
    // placeholders, `$<not-dot>` like `$outputs.country`, `$.` with no
    // field, `$..foo` empty segments, and multi-segment JSON Pointers that
    // don't root at a known envelope slot). Near-typos of envelope slots
    // (e.g. `$.input.xx.abc`) are NO LONGER flagged — per the post-2026-
    // 05-28 mustache QA principle, the playground auto-creates a variable
    // named after the root segment and the backend reports any shape
    // mismatch at render time. See `templateVariable.ts` for the full
    // validation policy.
    //
    // Tooltip content is published on data-* attributes; a React overlay
    // (TokenTooltipPlugin) reads them on hover and renders an Ant Tooltip.
    const expr = extractTemplateExpression(text)
    const result = validateTemplateVariable(expr)

    if (result.valid) {
        dom.style.backgroundColor = "var(--ag-c-E2E8F0)"
        dom.style.color = "var(--ag-c-1677FF)"
        dom.style.border = ""
    } else {
        dom.style.backgroundColor = "var(--ag-c-FEF2F2)" // red-50
        dom.style.color = "var(--ag-c-B91C1C)" // red-700
        dom.style.border = "1px dashed var(--ag-c-F87171)" // red-400
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
        if (text !== dom.textContent) dom.textContent = text
        // Re-apply styles even when text didn't change at this exact node —
        // edits to a nearby path segment can change validity without
        // changing this node's own text, but when it DOES change we also
        // need to re-evaluate because the new text may be valid/invalid.
        applyTokenStyles(dom, text)
        // The DOM is mutated in place; returning false tells Lexical the node
        // doesn't need to be re-created, which preserves selection and avoids
        // unnecessary churn.
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
