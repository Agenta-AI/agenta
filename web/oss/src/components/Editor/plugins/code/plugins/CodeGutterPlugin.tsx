/**
 * CodeGutterPlugin.tsx
 *
 * This plugin manages the line number gutter in the code editor.
 * It provides dynamic line numbering that updates in response to code folding
 * and content changes, maintaining proper line number display for visible lines.
 *
 * Features:
 * - Dynamic line number updates
 * - Handles folded line visibility
 * - Maintains correct numbering during edits
 * - Integrates with code folding
 *
 * @module CodeGutterPlugin
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const log = createLogger("CodeGutterPlugin", {
    disabled: true,
})

/**
 * Updates the line number gutter for a code block.
 * Generates line numbers only for visible lines, skipping hidden (folded) lines
 * while maintaining the actual line numbers for debugging purposes.
 *
 * @param editor - The Lexical editor instance
 * @param codeBlock - The code block node to update gutter for
 */
export function updateGutter(editor: any, codeBlock: any) {
    const codeElement = editor.getElementByKey(codeBlock.getKey())
    if (!codeElement) return

    const children = codeBlock.getChildren()?.filter($isCodeLineNode)
    if (!children) return

    // Build gutter numbers only for visible lines
    let gutter = ""
    let visibleCount = 0

    log("UPDATE GUTTER", children)

    /**
     * Build gutter numbers string:
     * 1. Iterate through all line nodes
     * 2. Only include numbers for visible (unfolded) lines
     * 3. Use actual line numbers (i+1) not sequential numbers
     * 4. Join numbers with newlines for proper display
     */
    for (let i = 0; i < children.length; i++) {
        const line = children[i]
        if (!line.isHidden()) {
            // Add newline between numbers except for first line
            if (visibleCount > 0) gutter += "\n"
            // Use 1-based line numbers (i+1)
            gutter += (i + 1).toString()
            visibleCount++
        }
    }

    log("UPDATE GUTTER count", gutter)
    codeElement.setAttribute("data-gutter", gutter)
}

/**
 * React component that implements line number gutter functionality.
 * Integrates with Lexical editor to provide dynamic line numbering
 * and updates the gutter display in response to editor changes.
 *
 * Key features:
 * - Maintains line numbers for visible lines
 * - Updates on content changes
 * - Syncs with code folding state
 * - Preserves actual line numbers
 *
 * @returns null - This is a behavior-only plugin
 */
export function CodeGutterPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        /**
         * Initial setup phase:
         * 1. Read current editor state
         * 2. Get root node and first child (code block)
         * 3. Validate we have a code block to work with
         * 4. Set up line classes and initial gutter
         */
        editor.getEditorState().read(() => {
            const root = $getRoot()
            const codeBlock = root.getFirstChild()
            if (!$isCodeBlockNode(codeBlock)) {
                log("No code block found during initial setup")
                return
            }

            /**
             * Set up line styling:
             * 1. Get all code line nodes
             * 2. Find corresponding DOM elements
             * 3. Add editor-code-line class for styling
             * 4. Track number of lines processed
             */
            log("Initial setup - adding editor-code-line class")
            const codeLines = codeBlock.getChildren().filter($isCodeLineNode)
            let addedClasses = 0
            codeLines.forEach((lineNode) => {
                const dom = editor.getElementByKey(lineNode.getKey())
                if (!dom) return
                if (!dom.classList.contains("editor-code-line")) {
                    dom.classList.add("editor-code-line")
                    addedClasses++
                }
            })

            log("Initial setup complete", {totalLines: codeLines.length, addedClasses})
            updateGutter(editor, codeBlock)
        })

        /**
         * Set up mutation listener for line changes:
         * 1. Listen specifically for CodeLineNode mutations
         * 2. Check for structural changes (node creation/deletion)
         * 3. Skip updates for non-structural changes (e.g. text edits)
         * 4. Update gutter when line structure changes
         */
        return editor.registerMutationListener(CodeLineNode, (mutations) => {
            // Check for node creation or deletion
            const hasStructuralChanges = Array.from(mutations.values()).some(
                (type) => type === "created" || type === "destroyed",
            )

            /**
             * Performance optimization:
             * - Log mutation details for debugging
             * - Skip unnecessary updates
             * - Only proceed if line structure changed
             */
            log("Mutation check", {
                mutations: Array.from(mutations.entries()),
                hasStructuralChanges,
            })
            if (!hasStructuralChanges) {
                log("Skipping gutter update - no structural changes")
                return
            }

            /**
             * Update gutter after structural changes:
             * 1. Read current editor state
             * 2. Get code block node
             * 3. Update gutter numbers
             */
            editor.getEditorState().read(() => {
                const root = $getRoot()
                const codeBlock = root.getFirstChild()
                if (!$isCodeBlockNode(codeBlock)) return

                const codeLines = codeBlock.getChildren().filter($isCodeLineNode)
                codeLines.forEach((lineNode) => {
                    const dom = editor.getElementByKey(lineNode.getKey())
                    if (!dom) return
                    dom.classList.add("editor-code-line")
                })

                log("Updating gutter due to structural changes")
                updateGutter(editor, codeBlock)
            })
        })
    }, [editor])

    return null
}
