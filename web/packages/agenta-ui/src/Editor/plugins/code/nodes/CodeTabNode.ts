/**
 * CodeTabNode.ts
 *
 * This module defines a custom Lexical node type for code blocks in the editor.
 * CodeTabNode represents a container for code content with specific language
 * highlighting (JSON or YAML). It extends ElementNode from Lexical and provides
 * DOM manipulation and serialization capabilities.
 *
 * @module CodeTabNode
 */

import {LexicalNode, SerializedTextNode, Spread, EditorConfig, TabNode} from "lexical"

/**
 * Represents the serialized form of a CodeTabNode.
 * Extends SerializedTextNode since CodeTabNode extends TabNode which extends TextNode.
 */
export type SerializedCodeTabNode = Spread<{}, SerializedTextNode>

/**
 * CodeTabNode class represents a code block in the editor.
 * It manages the rendering and behavior of code content with specific language highlighting.
 */
export class CodeTabNode extends TabNode {
    /**
     * Returns the node type identifier.
     * @returns The string identifier for this node type
     */
    static getType(): string {
        return "code-tab-block"
    }

    /**
     * Creates a copy of an existing CodeTabNode.
     * @param node - The node to clone
     * @returns A new CodeTabNode with the same properties
     */
    static clone(node: CodeTabNode): CodeTabNode {
        return new CodeTabNode(node.__key)
    }

    /**
     * Instance-level clone used by paste utilities.
     */
    clone(): CodeTabNode {
        return CodeTabNode.clone(this)
    }

    /**
     * Creates a new CodeTabNode instance.
     * @param language - The programming language for the code block (defaults to "json")
     * @param key - Optional unique identifier for the node
     */
    constructor(key?: string) {
        super(key)
    }

    /**
     * Creates the DOM element for this node.
     * Sets up a code element with appropriate classes and attributes for syntax highlighting.
     * @param config - Editor configuration
     * @returns HTMLElement representing the code block
     */
    createDOM(config: EditorConfig): HTMLElement {
        // const code = document.createElement("code")
        // code.classList.add("editor-code", `language-${this.__language}`, 'dark-theme')
        // code.classList.add("editor-code", `language-${this.__language}`)
        // code.setAttribute("data-language", this.__language)
        // code.setAttribute("tabindex", "0")
        // code.setAttribute("data-lexical-editor", "true")

        const dom = super.createDOM(config)
        dom.classList.add("editor-code-tab")
        return dom
    }

    /**
     * Determines if the DOM needs to be updated.
     * Always returns false as the node is replaced entirely when changed.
     * @returns false to indicate no incremental DOM updates
     */
    updateDOM(_prevNode: CodeTabNode, _dom: HTMLElement, _config: EditorConfig): boolean {
        return false
    }

    /**
     * Serializes the node for persistence.
     * @returns Serialized representation of the code block
     */
    exportJSON(): SerializedCodeTabNode {
        return super.exportJSON()
    }

    static importJSON(json: SerializedCodeTabNode): CodeTabNode {
        return new CodeTabNode()
    }

    isInline(): true {
        return true
    }
}

/**
 * Helper function to create a new CodeTabNode.
 * @returns A new CodeTabNode instance
 */
export function $createCodeTabNode(): CodeTabNode {
    return new CodeTabNode()
}

/**
 * Type guard to check if a node is a CodeTabNode.
 * @param node - The node to check
 * @returns True if the node is a CodeTabNode
 */
export function $isCodeTabNode(node: LexicalNode | null | undefined): node is CodeTabNode {
    return node instanceof CodeTabNode
}
