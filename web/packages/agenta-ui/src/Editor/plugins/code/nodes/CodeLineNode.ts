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
import {ElementNode, LexicalNode, SerializedElementNode, Spread} from "lexical"

import styles from "../components/assets/CodeBlockErrorIndicator.module.css"
import diffStyles from "../components/assets/DiffCodeBlock.module.css"
import {getCurrentEditorId} from "../core/validation/context"
import {getValidationManager} from "../core/validation/manager"
import type {ErrorInfo} from "../core/validation/types"

/**
 * Diff line types for code diff display
 */
export type DiffType = "added" | "removed" | "modified" | "context" | "fold" | null

/**
 * Represents the serialized form of a CodeLineNode.
 * Extends SerializedElementNode with properties for code folding state and diff display.
 */
export type SerializedCodeLineNode = Spread<
    {
        /** Whether this line can be folded (has child lines) */
        isFoldable?: boolean
        /** Whether this line is currently folded */
        isCollapsed?: boolean
        /** Whether this line is hidden due to parent folding */
        isHidden?: boolean
        /** Diff type for this line (added, removed, context, or null) */
        diffType?: DiffType
        /** Original file line number (for diff display) */
        oldLineNumber?: number
        /** New file line number (for diff display) */
        newLineNumber?: number
        /** Validation errors for this line */
        validationErrors?: ErrorInfo[]
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
    /** Diff type for this line (added, removed, context, or null) */
    __diffType: DiffType
    /** Original file line number (for diff display) */
    __oldLineNumber?: number
    /** New file line number (for diff display) */
    __newLineNumber?: number
    /** Validation errors for this line */
    __validationErrors: ErrorInfo[]

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
            node.__isEmpty ?? node.getTextContent().trim() === "",
            node.__diffType,
            node.__oldLineNumber,
            node.__newLineNumber,
        )

        // Copy validation errors directly during cloning
        clone.__validationErrors = [...node.__validationErrors]

        return clone
    }

    /**
     * Creates a new CodeLineNode instance.
     * @param key - Optional unique identifier for the node
     */
    clone(): CodeLineNode {
        return CodeLineNode.clone(this)
    }

    constructor(
        key?: string,
        isFoldable = false,
        isCollapsed = false,
        isHidden = false,
        isEmpty = false,
        diffType: DiffType = null,
        oldLineNumber?: number,
        newLineNumber?: number,
    ) {
        super(key)
        this.__isFoldable = isFoldable
        this.__isCollapsed = isCollapsed
        this.__isHidden = isHidden
        this.__isEmpty = isEmpty
        this.__diffType = diffType
        this.__oldLineNumber = oldLineNumber
        this.__newLineNumber = newLineNumber
        this.__validationErrors = []
        // Note: validationErrors can be set after construction via setValidationErrors()
    }

    /**
     * Gets the diff type for this line.
     * @returns The diff type (added, removed, context, or null)
     */
    getDiffType(): DiffType {
        return this.getLatest().__diffType
    }

    /**
     * Sets the diff type for this line.
     * @param diffType - The diff type to set
     * @returns This node for chaining
     */
    setDiffType(diffType: DiffType): this {
        const writable = this.getWritable()
        writable.__diffType = diffType
        return writable
    }

    /**
     * Gets the old line number for this line.
     * @returns The old line number or undefined
     */
    getOldLineNumber(): number | undefined {
        return this.getLatest().__oldLineNumber
    }

    /**
     * Sets the old line number for this line.
     * @param lineNumber - The old line number to set
     * @returns This node for chaining
     */
    setOldLineNumber(lineNumber: number | undefined): this {
        const writable = this.getWritable()
        writable.__oldLineNumber = lineNumber
        return writable
    }

    /**
     * Gets the new line number for this line.
     * @returns The new line number or undefined
     */
    getNewLineNumber(): number | undefined {
        return this.getLatest().__newLineNumber
    }

    /**
     * Sets the new line number for this line.
     * @param lineNumber - The new line number to set
     * @returns This node for chaining
     */
    setNewLineNumber(lineNumber: number | undefined): this {
        const writable = this.getWritable()
        writable.__newLineNumber = lineNumber
        return writable
    }

    /**
     * Gets the validation errors for this line.
     * Uses the unified ValidationManager as single source of truth.
     * @returns Array of validation errors for this line
     */
    getValidationErrors(): ErrorInfo[] {
        try {
            const editorId = getCurrentEditorId()
            if (!editorId) {
                // No active editor context; fall back to stored errors
                return this.getLatest().__validationErrors
            }

            const manager = getValidationManager(editorId)
            if (!manager) {
                // Manager not registered yet for this editor; fall back
                return this.getLatest().__validationErrors
            }

            const state = manager.getState()
            if (state.errors.length === 0) {
                return []
            }

            const lineNumber = this.getLineNumber()
            return manager.getErrorsForLine(lineNumber)
        } catch (error) {
            // Fallback to stored validation errors (for backward compatibility)
            console.warn(
                "Failed to retrieve ValidationManager from registry; using stored errors:",
                error,
            )
            return this.getLatest().__validationErrors
        }
    }

    /**
     * Sets the validation errors for this line.
     * @param errors - Array of validation errors to set
     * @returns This node for chaining
     */
    setValidationErrors(errors: ErrorInfo[]): this {
        const writable = this.getWritable()
        writable.__validationErrors = errors
        return writable
    }

    /**
     * Gets the primary validation error for this line (first error).
     * @returns The primary validation error or null if no errors
     */
    getValidationError(): ErrorInfo | null {
        const errors = this.getValidationErrors()
        return errors.length > 0 ? errors[0] : null
    }

    /**
     * Gets a best-effort 1-based line number for this line node.
     * Handles both flat (parent is CodeBlockNode) and segmented
     * (parent is CodeSegmentNode) structures.
     */
    private getLineNumber(): number {
        try {
            const parent = this.getParent()
            if (!parent) return 1

            // Check if parent is a segment (type "code-segment")
            if (parent.getType() === "code-segment") {
                const indexInSegment = this.getIndexWithinParent()
                const codeBlock = parent.getParent()
                if (!codeBlock) return indexInSegment + 1

                let offset = 0
                for (const child of codeBlock.getChildren()) {
                    if (child.getKey() === parent.getKey()) break
                    if (child.getType() === "code-segment" && "getChildrenSize" in child) {
                        offset += (child as ElementNode).getChildrenSize()
                    } else if (child.getType() === "code-line") {
                        offset += 1
                    }
                }
                return offset + indexInSegment + 1
            }

            // Legacy flat structure
            const index = this.getIndexWithinParent()
            return index >= 0 ? index + 1 : 1
        } catch {
            return 1
        }
    }

    /**
     * Creates the DOM element for this node.
     * Sets up the line container and fold toggle button if the line is foldable.
     * @returns HTMLElement representing the code line
     */
    createDOM(): HTMLElement {
        const latest = this.getLatest()
        const element = document.createElement("div")

        element.classList.add(
            "editor-code-line",
            styles["editor-code-line"],
            diffStyles["editor-code-diff-line"],
        )
        element.setAttribute("data-lexical-node-key", this.__key)

        // Apply diff styling if diff type is set
        if (latest.__diffType) {
            element.classList.add(`diff-${latest.__diffType}`)
            element.setAttribute("data-diff-type", latest.__diffType)
        }

        if (latest.__isHidden) {
            element.classList.add("folded")
        }

        // Set line numbers for GitHub-style diff display (but not for fold lines)
        if ((latest.__oldLineNumber || latest.__newLineNumber) && latest.__diffType !== "fold") {
            const oldNum = latest.__oldLineNumber ? latest.__oldLineNumber.toString() : ""
            const newNum = latest.__newLineNumber ? latest.__newLineNumber.toString() : ""
            element.setAttribute("data-old-line-number", oldNum)
            element.setAttribute("data-new-line-number", newNum)

            // CSS pseudo-elements handle the display formatting
            // Just set the data attributes for CSS to use
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

        if (prevNode.__isHidden !== latest.__isHidden) {
            dom.classList.toggle("folded", latest.__isHidden)
        }

        // Handle diff type changes
        if (prevNode.__diffType !== latest.__diffType) {
            // Remove old diff classes
            if (prevNode.__diffType) {
                dom.classList.remove(`diff-${prevNode.__diffType}`)
                dom.removeAttribute("data-diff-type")
            }
            // Add new diff classes
            if (latest.__diffType) {
                dom.classList.add(`diff-${latest.__diffType}`)
                dom.setAttribute("data-diff-type", latest.__diffType)
            }
        }

        // Handle line number changes
        if (
            prevNode.__oldLineNumber !== latest.__oldLineNumber ||
            prevNode.__newLineNumber !== latest.__newLineNumber
        ) {
            // Update line numbers for GitHub-style diff display
            if (latest.__oldLineNumber || latest.__newLineNumber) {
                const oldNum = latest.__oldLineNumber ? latest.__oldLineNumber.toString() : ""
                const newNum = latest.__newLineNumber ? latest.__newLineNumber.toString() : ""
                dom.setAttribute("data-old-line-number", oldNum)
                dom.setAttribute("data-new-line-number", newNum)
            } else {
                // Remove line number attributes if no longer needed
                dom.removeAttribute("data-old-line-number")
                dom.removeAttribute("data-new-line-number")
                // Note: Regular sequential line numbers are now handled by CSS counters
            }
        }

        if (
            prevNode.__isFoldable !== latest.__isFoldable ||
            prevNode.__isCollapsed !== latest.__isCollapsed
        ) {
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
        return this.getLatest().__isHidden
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
        return this.getLatest().__isFoldable
    }

    /**
     * Checks if this line is currently collapsed.
     * When collapsed, all nested content with greater
     * indentation is hidden from view.
     *
     * @returns True if line is collapsed, false otherwise
     */
    isCollapsed(): boolean {
        return this.getLatest().__isCollapsed
    }

    // /**
    //  * Exports this node to a DOM representation.
    //  * Creates a new DOM element with current folding state
    //  * and styling for external use.
    //  *
    //  * @returns Object containing the DOM element
    //  */
    // exportDOM(): DOMExportOutput {
    //     return {
    //         element: this.createDOM(),
    //     }
    // }

    // importDOM(): void {
    //     this.setDiffType(null)
    //     this.setOldLineNumber(undefined)
    //     this.setNewLineNumber(undefined)
    //     this.setValidationErrors([])
    // }

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
            isHidden: this.__isHidden,
            diffType: this.__diffType,
            validationErrors: this.__validationErrors,
            type: "code-line",
            version: 1,
        }
    }

    static importJSON(serializedNode: SerializedCodeLineNode): CodeLineNode {
        const node = new CodeLineNode(
            undefined, // key
            serializedNode.isFoldable ?? false,
            serializedNode.isCollapsed ?? false,
            serializedNode.isHidden ?? false,
            false, // isEmpty - will be calculated
            serializedNode.diffType ?? null,
            serializedNode.oldLineNumber,
            serializedNode.newLineNumber,
        )

        // Set validation errors directly during deserialization
        const validationErrors = serializedNode.validationErrors ?? []
        node.__validationErrors = validationErrors

        return node
    }
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
