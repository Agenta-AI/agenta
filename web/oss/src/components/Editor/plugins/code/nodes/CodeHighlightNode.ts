/**
 * CodeHighlightNode.ts
 *
 * This module defines a custom Lexical node type for syntax-highlighted code text.
 * CodeHighlightNode extends TextNode to provide syntax highlighting capabilities
 * for code content, applying appropriate token classes based on the token type.
 *
 * @module CodeHighlightNode
 */
import {
    TextNode,
    EditorConfig,
    LexicalNode,
    DOMExportOutput,
    SerializedTextNode,
    Spread,
    LexicalEditor,
} from "lexical"

/**
 * Represents the serialized form of a CodeHighlightNode.
 * Extends SerializedTextNode with a highlightType property for syntax highlighting.
 */
export type SerializedCodeHighlightNode = Spread<
    {
        highlightType: string
        hasValidationError: boolean
        validationMessage: string | null
    },
    SerializedTextNode
>

/**
 * CodeHighlightNode class represents a text node with syntax highlighting capabilities.
 * It extends TextNode to add syntax highlighting for code content.
 */
export class CodeHighlightNode extends TextNode {
    /** The type of syntax highlighting token to apply */
    __highlightType: string
    __hasValidationError = false
    __validationMessage: string | null

    /**
     * Returns the node type identifier.
     * @returns The string identifier for this node type
     */
    static getType(): string {
        return "code-highlight"
    }

    /**
     * Creates a copy of an existing CodeHighlightNode.
     * @param node - The node to clone
     * @returns A new CodeHighlightNode with the same text and highlighting
     */
    static clone(node: CodeHighlightNode): CodeHighlightNode {
        return new CodeHighlightNode(
            node.__text,
            node.__highlightType,
            node.__hasValidationError,
            node.__validationMessage,
            node.__key,
        )
    }

    /**
     * Creates a new CodeHighlightNode instance.
     * @param text - The text content of the node
     * @param highlightType - The type of syntax highlighting to apply
     * @param key - Optional unique identifier for the node
     */
    constructor(
        text: string,
        highlightType: string,
        hasValidationError: boolean,
        validationMessage: string | null,
        key?: string,
    ) {
        super(text, key)
        this.__highlightType = highlightType
        this.__hasValidationError = hasValidationError
        this.__validationMessage = validationMessage
    }

    /**
     * Creates the DOM element for this node.
     * Applies appropriate token classes for syntax highlighting.
     * @param config - Editor configuration
     * @returns HTMLElement with syntax highlighting classes
     */
    createDOM(config: EditorConfig): HTMLElement {
        const latest = this.getLatest()
        const dom = super.createDOM(config)
        
        // Apply token class based on highlight type
        dom.className = `editor-code-highlight token token-${latest.__highlightType}`
        
        // Ensure empty nodes have a minimum width for caret visibility
        if (latest.getTextContent() === "") {
            dom.classList.add("token-empty")
            // Set a minimum width to ensure caret visibility
            dom.style.minWidth = "1px"
            dom.style.display = "inline-block"
        }

        // Add validation error styling if needed
        if (latest.hasValidationError()) {
            dom.classList.add("token-error", "has-tooltip")
            if (latest.__validationMessage) {
                dom.setAttribute("data-tooltip", latest.__validationMessage)
            }
        }

        return dom
    }

    /**
     * Updates the DOM element when node properties change.
     * Only determines if the DOM needs updating based on property changes.
     * @param prevNode - Previous state of the node
     * @param dom - DOM element to update
     * @param config - Editor configuration
     * @returns True if the DOM was updated and needs to be recreated
     */
    updateDOM(prevNode: CodeHighlightNode, dom: HTMLElement, config: EditorConfig): boolean {
        const latest = this.getLatest()
        
        // Check if any properties have changed that would require DOM update
        const needsTokenTypeUpdate = latest.__highlightType !== prevNode.__highlightType
        const needsErrorUpdate = latest.__hasValidationError !== prevNode.__hasValidationError
        const needsValidationMessageUpdate =
            latest.__validationMessage !== prevNode.__validationMessage
        const needsEmptyUpdate = 
            (latest.getTextContent() === "" && prevNode.getTextContent() !== "") ||
            (latest.getTextContent() !== "" && prevNode.getTextContent() === "")

        // If any properties changed that affect rendering, return true to trigger DOM recreation
        if (needsTokenTypeUpdate || needsErrorUpdate || needsValidationMessageUpdate || needsEmptyUpdate) {
            return true
        }

        // Otherwise, let the parent class decide if update is needed
        return super.updateDOM(prevNode as this, dom, config)
    }

    /**
     * Exports the node to a DOM representation for external use.
     * @param editor - The Lexical editor instance
     * @returns DOM export output
     */
    exportDOM(editor: LexicalEditor): DOMExportOutput {
        return super.exportDOM(editor)
    }

    exportJSON(): SerializedCodeHighlightNode {
        return {
            ...super.exportJSON(),
            type: "code-highlight",
            hasValidationError: this.__hasValidationError,
            validationMessage: this.__validationMessage,
            highlightType: this.__highlightType,
            version: 1,
        }
    }

    static importJSON(json: SerializedCodeHighlightNode): CodeHighlightNode {
        return new CodeHighlightNode(
            json.text,
            json.highlightType,
            json.hasValidationError,
            json.validationMessage,
        )
    }

    setHighlightType(type: string): void {
        this.getWritable().__highlightType = type
    }

    getHighlightType(): string {
        return this.getLatest().__highlightType
    }

    setValidationError(flag: boolean) {
        this.getWritable().__hasValidationError = flag
    }

    getValidationError(): boolean {
        return this.getLatest().__hasValidationError
    }

    hasValidationError(): boolean {
        return this.getValidationError()
    }

    getValidationMessage(): string | null {
        return this.__validationMessage
    }

    setValidationMessage(msg: string | null): void {
        const writable = this.getWritable<CodeHighlightNode>()
        writable.__validationMessage = msg
    }
}

/**
 * Helper function to create a new CodeHighlightNode.
 * @param text - The text content for the node
 * @param highlightType - The type of syntax highlighting to apply
 * @returns A new CodeHighlightNode instance
 */
export function $createCodeHighlightNode(
    text: string,
    highlightType: string,
    hasValidationError: boolean,
    validationMessage: string | null,
    key?: string,
): CodeHighlightNode {
    return new CodeHighlightNode(text, highlightType, hasValidationError, validationMessage, key)
}

/**
 * Type guard to check if a node is a CodeHighlightNode.
 * @param node - The node to check
 * @returns True if the node is a CodeHighlightNode
 */
export function $isCodeHighlightNode(
    node: LexicalNode | null | undefined,
): node is CodeHighlightNode {
    return node instanceof CodeHighlightNode
}
