/**
 * CodeLineNode.ts
 *
 * This module defines a custom Lexical node type for code lines in the editor.
 * CodeLineNode represents a single line of code with support for code folding,
 * indentation, and line visibility management. It extends ElementNode to provide
 * these specialized code editing features.
 *
 * @module CodeLineNode
 */
import {ElementNode, LexicalNode, SerializedElementNode, DOMExportOutput, Spread} from "lexical"

/**
 * Represents the serialized form of a CodeLineNode.
 * Extends SerializedElementNode with properties for code folding state.
 */
export type SerializedCodeLineNode = Spread<
    {
        /** Whether this line can be folded (has child lines) */
        isFoldable?: boolean
        /** Whether this line is currently folded */
        isCollapsed?: boolean
        /** Whether this line is hidden due to parent folding */
        isHidden?: boolean
    },
    SerializedElementNode
>

/**
 * CodeLineNode class represents a single line of code in the editor.
 * It manages code folding state and line visibility, providing UI elements
 * for fold/unfold actions when appropriate.
 */
export class CodeLineNode extends ElementNode {
    /** Whether this line can be folded (has child lines) */
    __isFoldable: boolean
    /** Whether this line is currently folded */
    __isCollapsed: boolean
    /** Whether this line is hidden due to parent folding */
    __isHidden: boolean

    /**
     * Returns the node type identifier.
     * @returns The string identifier for this node type
     */
    static getType(): string {
        return "code-line"
    }

    /**
     * Creates a copy of an existing CodeLineNode.
     * @param node - The node to clone
     * @returns A new CodeLineNode with the same folding state
     */
    static clone(node: CodeLineNode): CodeLineNode {
        const clone = new CodeLineNode(node.__key)
        clone.__isFoldable = node.__isFoldable
        clone.__isCollapsed = node.__isCollapsed
        clone.__isHidden = node.__isHidden
        return clone
    }

    /**
     * Creates a new CodeLineNode instance.
     * @param key - Optional unique identifier for the node
     */
    constructor(key?: string) {
        super(key)
        this.__isFoldable = false
        this.__isCollapsed = false
        this.__isHidden = false
    }

    /**
     * Creates the DOM element for this node.
     * Sets up the line container and fold toggle button if the line is foldable.
     * @returns HTMLElement representing the code line
     */
    createDOM(): HTMLElement {
        const element = document.createElement("div")
        element.classList.add("editor-code-line")
        element.setAttribute("data-lexical-node-key", this.__key)
        if (this.__isHidden) {
            element.classList.add("folded")
        }

        if (this.__isFoldable) {
            const btn = document.createElement("button")
            btn.className = "fold-toggle"
            btn.textContent = this.__isCollapsed ? "▸" : "▾"
            element.appendChild(btn)
        }

        return element
    }

    /**
     * Updates the DOM representation of this node when its state changes.
     * Handles fold button visibility and styling based on fold state.
     *
     * Key steps:
     * 1. Check if any folding state has changed
     * 2. Remove existing fold button if present
     * 3. Add new fold button if line is foldable
     * 4. Style button based on current state
     *
     * @param prevNode - Previous version of this node
     * @param dom - Current DOM element for this node
     * @returns True if DOM was updated, false otherwise
     */
    updateDOM(prevNode: CodeLineNode, dom: HTMLElement): boolean {
        // Check for any state changes that require DOM updates
        if (
            prevNode.__isFoldable !== this.__isFoldable ||
            prevNode.__isCollapsed !== this.__isCollapsed ||
            prevNode.__isHidden !== this.__isHidden
        ) {
            // Remove old button if it exists
            const oldBtn = dom.querySelector(".fold-toggle")
            if (oldBtn) {
                oldBtn.remove()
            }

            // Add new button if needed
            if (this.__isFoldable) {
                const btn = document.createElement("button")
                btn.className = "fold-toggle"
                btn.textContent = this.__isCollapsed ? "▸" : "▾"
                btn.style.position = "absolute"
                btn.style.left = "-1.5em"
                btn.style.top = "0"
                btn.style.cursor = "pointer"
                btn.style.background = "none"
                btn.style.border = "none"
                btn.style.fontSize = "1em"
                dom.appendChild(btn)
                dom.style.position = "relative"
            }

            return true
        }

        return false
    }

    /**
     * Sets whether this line can be folded.
     * A line is foldable if it has nested content below it
     * at a greater indentation level.
     *
     * @param isFoldable - Whether line should be foldable
     */
    setFoldable(isFoldable: boolean): void {
        const writable = this.getWritable()
        writable.__isFoldable = isFoldable
    }

    /**
     * Sets the collapsed state of this line.
     * When collapsed, all nested content is hidden.
     * Updates fold button appearance and triggers visibility
     * updates for child lines.
     *
     * @param isCollapsed - Whether line should be collapsed
     */
    setCollapsed(isCollapsed: boolean): void {
        const writable = this.getWritable()
        writable.__isCollapsed = isCollapsed
    }

    /**
     * Checks if this line is currently hidden.
     * A line can be hidden if it is nested under a collapsed parent line.
     * Hidden lines are not visible in the editor but maintain their state.
     *
     * @returns True if line is hidden, false otherwise
     */
    isHidden(): boolean {
        return this.__isHidden
    }

    /**
     * Sets the hidden state of this line.
     * Used when a parent line is collapsed/expanded to hide/show
     * this line. Updates DOM classes to control visibility.
     *
     * @param isHidden - Whether line should be hidden
     */
    setHidden(isHidden: boolean): void {
        const writable = this.getWritable()
        writable.__isHidden = isHidden
    }

    /**
     * Checks if this line can be folded.
     * A line is foldable if it contains nested content
     * with greater indentation below it.
     *
     * @returns True if line is foldable, false otherwise
     */
    isFoldable(): boolean {
        return this.__isFoldable
    }

    /**
     * Checks if this line is currently collapsed.
     * When collapsed, all nested content with greater
     * indentation is hidden from view.
     *
     * @returns True if line is collapsed, false otherwise
     */
    isCollapsed(): boolean {
        return this.__isCollapsed
    }

    /**
     * Exports this node to a DOM representation.
     * Creates a new DOM element with current folding state
     * and styling for external use.
     *
     * @returns Object containing the DOM element
     */
    exportDOM(): DOMExportOutput {
        return {
            element: this.createDOM(),
        }
    }

    /**
     * Serializes this node to JSON format.
     * Includes all folding state for persistence and
     * reconstruction. Used for copy/paste and undo/redo.
     *
     * @returns Serialized representation of the node
     */
    exportJSON(): SerializedCodeLineNode {
        return {
            ...super.exportJSON(),
            isFoldable: this.__isFoldable,
            isCollapsed: this.__isCollapsed,
            type: "code-line",
            version: 1,
        }
    }

    static importJSON(serializedNode: SerializedCodeLineNode): CodeLineNode {
        const node = new CodeLineNode()
        node.__isFoldable = serializedNode.isFoldable ?? false
        node.__isCollapsed = serializedNode.isCollapsed ?? false
        return node
    }

    // /**
    //  * Indicates this node is not an inline element.
    //  * CodeLineNodes are always block-level elements that
    //  * represent full lines of code.
    //  *
    //  * @returns Always false as code lines are block elements
    //  */
    // isInline(): false {
    //     return false
    // }

    // /**
    //  * Indicates this node can contain no content.
    //  * Empty lines are valid in code blocks, representing
    //  * blank lines in the code.
    //  *
    //  * @returns Always true as code lines can be empty
    //  */
    // canBeEmpty(): boolean {
    //     return true
    // }
}

/**
 * Helper function to create a new CodeLineNode.
 * @returns A new CodeLineNode instance
 */
export function $createCodeLineNode(): CodeLineNode {
    return new CodeLineNode()
}

/**
 * Type guard to check if a node is a CodeLineNode.
 * @param node - The node to check
 * @returns True if the node is a CodeLineNode
 */
export function $isCodeLineNode(node: LexicalNode | null | undefined): node is CodeLineNode {
    return node instanceof CodeLineNode
}
