/**
 * EmptyNodeTransformPlugin.tsx
 *
 * This plugin ensures proper handling of empty CodeHighlightNodes and removes zero-width spaces.
 * It also fixes invalid selections on TabNodes and other non-editable nodes.
 * Additionally, it cleans up redundant nodes and merges adjacent CodeHighlightNodes when appropriate.
 * It uses a selection change command to ensure compatibility with other plugins while maintaining
 * proper caret visibility.
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $getSelection,
    $isRangeSelection,
    $createRangeSelection,
    $setSelection,
    $isTabNode,
    LexicalNode,
    RangeSelection,
} from "lexical"

import {$isCodeHighlightNode} from "../nodes/CodeHighlightNode"
import {$isCodeLineNode} from "../nodes/CodeLineNode"
import {createLogger} from "../utils/createLogger"

const PLUGIN_NAME = "EmptyNodeTransformPlugin"
const log = createLogger(PLUGIN_NAME, {disabled: true})

// Flag to prevent recursive cleanup operations
let isCleanupInProgress = false

/**
 * Plugin that ensures proper handling of nodes in code blocks by:
 * 1. Removing zero-width spaces from nodes while preserving selection
 * 2. Ensuring empty nodes are properly styled for caret visibility
 * 3. Fixing invalid selections on TabNodes and other non-editable nodes
 * 4. Moving selection to adjacent editable nodes when needed
 * 5. Cleaning up redundant nodes (e.g., empty nodes after content nodes)
 * 6. Merging adjacent CodeHighlightNodes with the same formatting
 *
 * Uses the selection change command to monitor and fix issues without disrupting other plugins.
 */
export function EmptyNodeTransformPlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        // Register a listener for editor updates to clean up redundant nodes
        const removeUpdateListener = editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || isCleanupInProgress) {
                    return
                }

                // Get the current node where the selection is
                const anchorNode = selection.anchor.getNode()

                // Find all code line nodes in the editor and clean them up
                const codeLines = anchorNode.getParents().filter($isCodeLineNode)
                if (codeLines.length > 0) {
                    // Clean up the current code line
                    editor.update(
                        () => {
                            $cleanupRedundantNodes(anchorNode, selection)
                        },
                        {
                            skipTransforms: true,
                        },
                    )
                }
            })
        })

        // Register a command to handle selection changes
        // const removeSelectionListener = editor.registerCommand(
        //     SELECTION_CHANGE_COMMAND,
        //     () => {
        //         log("SELECTION CHANGE COMMAND")
        //         const selection = $getSelection()
        //         if (!$isRangeSelection(selection)) {
        //             return false
        //         }

        //         // Get the current node where the selection is
        //         const anchorNode = selection.anchor.getNode()

        //         // Clean up redundant nodes in the current line
        //         // Only run if we're not already in a cleanup operation
        //         if (!isCleanupInProgress) {
        //             $cleanupRedundantNodes(anchorNode, selection)
        //         }

        //         // Handle TabNode selection issue - but allow selections at offset 0
        //         // This lets users navigate to tab nodes with left arrow key
        //         const currentNodeKey = anchorNode.getKey()

        //         // Skip if we're in a cleanup or if we've just seen this tab node
        //         // This prevents interference with the HorizontalNavigationPlugin
        //         if (
        //             $isTabNode(anchorNode) &&
        //             selection.anchor.offset > 0 &&
        //             !isCleanupInProgress &&
        //             currentNodeKey !== lastTabNodeKey
        //         ) {
        //             // Remember this node to avoid processing it again immediately
        //             lastTabNodeKey = currentNodeKey

        //             // Clear the lastTabNodeKey after a short delay
        //             setTimeout(() => {
        //                 lastTabNodeKey = null
        //             }, 100)
        //             log("⚠️ Selection on TabNode detected", {
        //                 nodeKey: anchorNode.getKey(),
        //                 nodeType: anchorNode.getType(),
        //                 offset: selection.anchor.offset,
        //             })

        //             // Find a suitable node to move selection to
        //             const parent = anchorNode.getParent()
        //             if ($isCodeLineNode(parent)) {
        //                 // Try to find a CodeHighlightNode sibling
        //                 const nextSibling = anchorNode.getNextSibling()
        //                 const prevSibling = anchorNode.getPreviousSibling()

        //                 // Prefer next sibling, then previous, then create new if needed
        //                 let targetNode = null
        //                 let targetOffset = 0

        //                 if (nextSibling && $isCodeHighlightNode(nextSibling)) {
        //                     targetNode = nextSibling
        //                     targetOffset = 0 // Beginning of next node
        //                 } else if (prevSibling && $isCodeHighlightNode(prevSibling)) {
        //                     targetNode = prevSibling
        //                     targetOffset = prevSibling.getTextContentSize() // End of previous node
        //                 }

        //                 if (targetNode) {
        //                     log("🔄 Moving selection to adjacent CodeHighlightNode", {
        //                         from: anchorNode.getKey(),
        //                         to: targetNode.getKey(),
        //                         offset: targetOffset,
        //                     })

        //                     // Create and set the new selection
        //                     const newSelection = $createRangeSelection()
        //                     newSelection.anchor.set(targetNode.getKey(), targetOffset, "text")
        //                     newSelection.focus.set(targetNode.getKey(), targetOffset, "text")
        //                     $setSelection(newSelection)
        //                     return true
        //                 }
        //             }
        //         }

        //         // Only process CodeHighlightNodes for zero-width space removal
        //         if (!$isCodeHighlightNode(anchorNode)) {
        //             return false
        //         }

        //         log("Selection in CodeHighlightNode:", {
        //             nodeKey: anchorNode.getKey(),
        //             text: anchorNode.getTextContent(),
        //             textLength: anchorNode.getTextContent().length,
        //         })

        //         // Check if the node contains zero-width spaces and remove them
        //         const text = anchorNode.getTextContent()
        //         if (text.includes("\u200B")) {
        //             log("Found zero-width space, removing it")

        //             // Store current selection position
        //             const currentOffset = selection.anchor.offset

        //             // Count zero-width spaces before the current position to adjust offset
        //             const zeroWidthSpacesBeforeCursor = (
        //                 text.substring(0, currentOffset).match(/\u200B/g) || []
        //             ).length

        //             // Remove zero-width spaces
        //             const writable = anchorNode.getWritable()
        //             const newText = text.replace(/\u200B/g, "")
        //             writable.setTextContent(newText)

        //             // Calculate new offset (current offset minus removed zero-width spaces)
        //             const newOffset = Math.max(0, currentOffset - zeroWidthSpacesBeforeCursor)

        //             // Create a new selection at the adjusted position
        //             const newSelection = $createRangeSelection()
        //             newSelection.anchor.set(anchorNode.getKey(), newOffset, "text")
        //             newSelection.focus.set(anchorNode.getKey(), newOffset, "text")
        //             $setSelection(newSelection)

        //             log("After removing zero-width space:", {
        //                 newText,
        //                 originalOffset: currentOffset,
        //                 newOffset,
        //                 zeroWidthSpacesBeforeCursor,
        //             })

        //             // After removing zero-width spaces, the update listener will handle cleanup
        //         }

        //         // If the node is empty, make sure it has the proper class
        //         // This is handled by the node's createDOM and updateDOM methods
        //         // but we ensure it's triggered by marking the node as dirty if needed
        //         if (anchorNode.getTextContent() === "") {
        //             log("Empty node detected, marking for re-render")
        //             // Force a re-render of the node to ensure proper styling
        //             anchorNode.getWritable()
        //             // No need to actually change anything, just accessing the writable
        //             // will mark the node as dirty and trigger a re-render
        //         }

        //         return false
        //     },
        //     COMMAND_PRIORITY_LOW,
        // )

        // Return cleanup function to remove listeners
        return () => {
            removeUpdateListener()
            // removeSelectionListener()
        }
    }, [editor])

    return null
}

/**
 * Cleans up redundant nodes in a code line and adjacent lines, such as:
 * - Empty CodeHighlightNodes after content nodes
 * - Adjacent CodeHighlightNodes that can be merged
 * - Zero-width space nodes that are unnecessary
 * - Removes highlight nodes with only zero-width chars when not the only non-tab node
 *
 * Uses a flag to prevent recursive invocation and limits the number of operations
 * to avoid infinite loops.
 *
 * @param currentNode - The node where the selection is currently located
 * @param selection - The current selection
 */
function $cleanupRedundantNodes(currentNode: LexicalNode, selection: RangeSelection) {
    // Set flag to prevent recursive cleanup
    isCleanupInProgress = true

    // Find the parent CodeLineNode to examine all its children
    const codeLine = currentNode.getParents().find($isCodeLineNode)
    if (!codeLine) {
        isCleanupInProgress = false
        return
    }

    // Get the parent code block to find adjacent lines
    const codeBlock = codeLine.getParent()
    if (!codeBlock) {
        isCleanupInProgress = false
        return
    }

    // Find the current line's index in the code block
    const codeLines = codeBlock.getChildren()
    const currentLineIndex = codeLines.findIndex((line) => line.getKey() === codeLine.getKey())

    if (currentLineIndex === -1) {
        isCleanupInProgress = false
        return
    }

    // Get previous and next lines if they exist
    const prevLine = currentLineIndex > 0 ? codeLines[currentLineIndex - 1] : null
    const nextLine =
        currentLineIndex < codeLines.length - 1 ? codeLines[currentLineIndex + 1] : null

    // Process the current line first
    $processLine(codeLine, selection)

    // Process previous and next lines if they exist
    if (prevLine && $isCodeLineNode(prevLine)) {
        $processLine(prevLine, selection)
    }

    if (nextLine && $isCodeLineNode(nextLine)) {
        $processLine(nextLine, selection)
    }

    // Reset flag after cleanup is complete
    isCleanupInProgress = false
}

/**
 * Process a single line to clean up redundant nodes
 * @param codeLine - The CodeLineNode to process
 * @param selection - The current selection
 */
function $processLine(codeLine: LexicalNode, selection: RangeSelection) {
    const children = codeLine.getChildren()
    if (children.length <= 1) {
        return
    } // Nothing to clean up

    // Store selection info for restoring later if needed
    const selectionInfo = {
        anchorKey: selection.anchor.key,
        anchorOffset: selection.anchor.offset,
        focusKey: selection.focus.key,
        focusOffset: selection.focus.offset,
    }

    const nodesMerged = false
    let redundantNodesRemoved = false

    // Limit the number of operations to prevent infinite loops
    const MAX_OPERATIONS = 10
    let operationCount = 0

    // Count non-tab nodes and content nodes (nodes with actual text content)
    const nonTabNodes = children.filter((node) => !$isTabNode(node))
    const contentNodes = nonTabNodes.filter((node) => {
        if (!$isCodeHighlightNode(node)) return true
        const text = node.getTextContent()
        return text !== "" && text !== "\u200B" && !text.match(/^\u200B+$/)
    })

    // First pass: identify and remove nodes with only zero-width spaces when not the only content node
    if (contentNodes.length > 0) {
        for (let i = children.length - 1; i >= 0; i--) {
            const node = children[i]

            // Skip non-CodeHighlightNodes and tab nodes
            if (!$isCodeHighlightNode(node) || $isTabNode(node)) continue

            const text = node.getTextContent()

            // Check if this node only contains zero-width spaces
            if (text.match(/^\u200B+$/) || text === "") {
                // Only remove if it's not the only non-tab node and not the current selection
                if (nonTabNodes.length > 1 && node.getKey() !== selectionInfo.anchorKey) {
                    log("🧹 Removing node with only zero-width spaces", {
                        nodeKey: node.getKey(),
                        content: text,
                        nonTabNodesCount: nonTabNodes.length,
                    })

                    // Remove the node
                    node.remove()
                    redundantNodesRemoved = true
                    operationCount++
                }
            }
        }
    }

    // Refresh children list after removals
    const updatedChildren = codeLine.getChildren()

    // Second pass: identify and handle redundant zero-width space nodes
    for (let i = 0; i < updatedChildren.length; i++) {
        const node = updatedChildren[i]

        // Skip non-CodeHighlightNodes
        if (!$isCodeHighlightNode(node)) continue

        const text = node.getTextContent()

        // Case 1: Check for redundant zero-width space nodes after content nodes
        if (text === "\u200B" && i > 0) {
            const prevNode = updatedChildren[i - 1]
            if ($isCodeHighlightNode(prevNode) && prevNode.getTextContent() !== "\u200B") {
                log("🧹 Removing redundant zero-width space node", {
                    nodeKey: node.getKey(),
                    prevNodeKey: prevNode.getKey(),
                    prevNodeContent: prevNode.getTextContent(),
                })

                // If selection is on this node, move it to the previous node
                if (node.getKey() === selectionInfo.anchorKey) {
                    const prevNodeContent = prevNode.getTextContent()
                    const newSelection = $createRangeSelection()
                    newSelection.anchor.set(prevNode.getKey(), prevNodeContent.length, "text")
                    newSelection.focus.set(prevNode.getKey(), prevNodeContent.length, "text")
                    $setSelection(newSelection)
                }

                // Remove the redundant node
                node.remove()
                redundantNodesRemoved = true
                operationCount++
                continue
            }
        }
    }

    if (nodesMerged || redundantNodesRemoved) {
        log("🧹 Line cleanup completed", {
            lineKey: codeLine.getKey(),
            nodesMerged,
            redundantNodesRemoved,
            operationsPerformed: operationCount,
            lineChildren: codeLine.getChildren().length,
        })
    }
}
