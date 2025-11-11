/**
 * CodeBlockNode.ts
 *
 * This module defines a custom Lexical node type for code blocks in the editor.
 * CodeBlockNode represents a container for code content with specific language
 * highlighting (JSON or YAML). It extends ElementNode from Lexical and provides
 * DOM manipulation and serialization capabilities.
 *
 * @module CodeBlockNode
 */

import {ElementNode, LexicalNode, SerializedElementNode, Spread, EditorConfig} from "lexical"

/**
 * Represents the serialized form of a CodeBlockNode.
 * Extends SerializedElementNode with a language property.
 */
export type SerializedCodeBlockNode = Spread<
    {
        language: "json" | "yaml"
        hasValidationError: boolean
    },
    SerializedElementNode
>

/**
 * CodeBlockNode class represents a code block in the editor.
 * It manages the rendering and behavior of code content with specific language highlighting.
 */
export class CodeBlockNode extends ElementNode {
    /** The programming language for syntax highlighting */
    __language: "json" | "yaml"
    __hasValidationError: boolean

    /**
     * Returns the node type identifier.
     * @returns The string identifier for this node type
     */
    static getType(): string {
        return "code-block"
    }

    /**
     * Creates a copy of an existing CodeBlockNode.
     * @param node - The node to clone
     * @returns A new CodeBlockNode with the same properties
     */
    static clone(node: CodeBlockNode): CodeBlockNode {
        return new CodeBlockNode(node.__language, node.__hasValidationError, node.__key)
    }

    /**
     * Creates a new CodeBlockNode instance.
     * @param language - The programming language for the code block (defaults to "json")
     * @param key - Optional unique identifier for the node
     */
    constructor(language: "json" | "yaml" = "json", hasValidationError?: boolean, key?: string) {
        super(key)
        this.__language = language
        this.__hasValidationError = hasValidationError ?? false
    }

    /**
     * Creates the DOM element for this node.
     * Sets up a code element with appropriate classes and attributes for syntax highlighting.
     * @param config - Editor configuration
     * @returns HTMLElement representing the code block
     */
    createDOM(config: EditorConfig): HTMLElement {
        const code = document.createElement("code")
        // code.classList.add("editor-code", `language-${this.__language}`, 'dark-theme')
        code.classList.add("editor-code", `language-${this.__language}`)
        code.setAttribute("data-language", this.__language)
        code.setAttribute("tabindex", "0")
        code.setAttribute("data-lexical-editor", "true")

        const hasError = this.__hasValidationError

        if (hasError) {
            const badge = document.createElement("span")
            badge.className = "code-block-error-icon"
            badge.textContent = "⚠️"
            code.appendChild(badge)
        }

        return code
    }

    /**
     * Determines if the DOM needs to be updated.
     * Always returns false as the node is replaced entirely when changed.
     * @returns false to indicate no incremental DOM updates
     */
    updateDOM(prevNode: CodeBlockNode, dom: HTMLElement): boolean {
        const languageChanged = this.__language !== prevNode.__language
        const errorChanged = this.hasValidationError() !== prevNode.__hasValidationError

        return languageChanged || errorChanged
    }

    /**
     * Serializes the node for persistence.
     * @returns Serialized representation of the code block
     */
    exportJSON(): SerializedCodeBlockNode {
        return {
            ...super.exportJSON(),
            type: "code-block",
            language: this.__language,
            hasValidationError: this.__hasValidationError,
            version: 1,
        }
    }

    static importJSON(json: SerializedCodeBlockNode): CodeBlockNode {
        return new CodeBlockNode(json.language, json.hasValidationError)
    }

    isInline(): false {
        return false
    }

    getLanguage(): "json" | "yaml" {
        return this.getLatest().__language
    }

    setLanguage(language: "json" | "yaml") {
        const writable = this.getWritable()
        writable.__language = language
    }

    setValidationError(flag: boolean): void {
        this.getWritable().__hasValidationError = flag
    }

    getValidationError(): boolean {
        return this.getLatest().__hasValidationError
    }

    hasValidationError(): boolean {
        return this.getLatest().__hasValidationError
    }
}

/**
 * Helper function to create a new CodeBlockNode.
 * @param language - The programming language for the code block
 * @returns A new CodeBlockNode instance
 */
export function $createCodeBlockNode(
    language: "json" | "yaml",
    hasValidationError?: boolean,
): CodeBlockNode {
    return new CodeBlockNode(language, hasValidationError)
}

/**
 * Type guard to check if a node is a CodeBlockNode.
 * @param node - The node to check
 * @returns True if the node is a CodeBlockNode
 */
export function $isCodeBlockNode(node: LexicalNode | null | undefined): node is CodeBlockNode {
    return node instanceof CodeBlockNode
}
