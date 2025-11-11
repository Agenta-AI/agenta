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
    /** Whether this line is empty */
    __isEmpty: boolean
    __index: number

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
        const clone = new CodeLineNode(
            node.__key,
            node.__isFoldable,
            node.__isCollapsed,
            node.__isHidden,
            node.__isEmpty ??
                (node.getTextContent() === "\u200b" || node.getTextContent().trim() === ""),
        )
        return clone
    }

    /**
     * Creates a new CodeLineNode instance.
     * @param key - Optional unique identifier for the node
     */
    constructor(
        key?: string,
        isFoldable = false,
        isCollapsed = false,
        isHidden = false,
        isEmpty = false,
    ) {
        super(key)
        this.__isFoldable = isFoldable
        this.__isCollapsed = isCollapsed
        this.__isHidden = isHidden
        this.__isEmpty = isEmpty
    }

    /**
     * Creates the DOM element for this node.
     * Sets up the line container and fold toggle button if the line is foldable.
     * @returns HTMLElement representing the code line
     */
    createDOM(): HTMLElement {
        const latest = this.getLatest()
        const element = document.createElement("div")
        element.classList.add("editor-code-line")
        element.setAttribute("data-lexical-node-key", this.__key)
        if (latest.__isHidden) {
            element.classList.add("folded")
        }

        if (latest.__isFoldable) {
            const btn = document.createElement("button")
            btn.className = "fold-toggle"
            btn.textContent = this.__isCollapsed ? "▸" : "▾"
            element.appendChild(btn)
        }

        if (latest.__index !== undefined && latest.__index > 0) {
            element.setAttribute("data-gutter", latest.__index.toString())
        } else {
            const foundIndex = latest.getIndexWithinParent()
            if (foundIndex >= 0) {
                element.setAttribute("data-gutter", (foundIndex + 1).toString())
            } else {
                element.setAttribute("data-gutter", "")
            }
        }

        if (latest.__isEmpty === undefined || latest.__isEmpty) {
            element.classList.add("block")
            element.classList.remove("flex")
            // element.classList.toggle("bg-[red]", false)
        } else {
            element.classList.remove("block")
            element.classList.add("flex")
            // element.classList.toggle("bg-[red]", true)
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
        const latest = this.getLatest()
        const latestContent = latest.getTextContent()
        const isEmpty = latestContent === "\u200b" || latestContent.trim() === ""
        const latestIndex = latest.getIndexWithinParent() + 1

        if (
            prevNode.__isFoldable !== latest.__isFoldable ||
            prevNode.__isCollapsed !== latest.__isCollapsed ||
            prevNode.__isHidden !== latest.__isHidden ||
            prevNode.__isEmpty !== isEmpty ||
            prevNode.__index !== latestIndex
        ) {
            if (prevNode.__isEmpty !== isEmpty) {
                this.getWritable().__isEmpty = isEmpty
            }
            if (prevNode.__index !== latestIndex) {
                this.getWritable().__index = latestIndex
            }
            // Remove old button if it exists
            const oldBtn = dom.querySelector(".fold-toggle")
            if (oldBtn) {
                oldBtn.remove()
            }

            // Add new button if needed
            if (latest.__isFoldable) {
                const btn = document.createElement("button")
                btn.className = "fold-toggle"
                btn.textContent = latest.__isCollapsed ? "▸" : "▾"
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
