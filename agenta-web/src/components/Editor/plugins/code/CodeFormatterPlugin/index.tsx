import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {useEffect} from "react"
import {
    COMMAND_PRIORITY_LOW,
    KEY_ENTER_COMMAND,
    $getSelection,
    $isRangeSelection,
    $isLineBreakNode,
    $isTabNode,
    LexicalEditor,
    LexicalNode,
    $getNodeByKey,
} from "lexical"
import {$isCodeNode, CodeNode} from "../CodeNode/CodeNode"
import {$isCodeHighlightNode, CodeHighlightNode} from "../CodeNode/CodeHighlightNode"
import {$createCodeLineNode, $isCodeLineNode, CodeLineNode} from "../CodeNode/CodeLineNode"
import {getIndentationRules} from "./indentationRules"
import {updateCodeGutter} from "../CodeNode/CodeHighlighter/utils/gutter"

function handleLineBreak(_event: KeyboardEvent, _editor: LexicalEditor) {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return false

    const node = selection.anchor.getNode()
    const parent = node.getParent()
    const grandparent = parent?.getParent()
    if (!$isCodeNode(grandparent) || !$isCodeLineNode(parent)) return false

    const language = grandparent.getLanguage()
    const rules = getIndentationRules(language)

    // Get previous node's indent level
    const prevIndentLevel = parent ? parent.getIndentLevel() : 0

    // Start with previous line's indentation
    let newIndentLevel = prevIndentLevel

    const cursorOffset = selection.anchor.offset
    let nodeText = node.getTextContent()
    const currentLine = nodeText.slice(0, cursorOffset)
    const remainingText = nodeText.slice(cursorOffset)

    // Check if we need to increase indent (e.g. after opening brace)
    if (rules.increaseIndentPattern.test(currentLine)) {
        newIndentLevel++
    }
    // Check if we need to decrease indent (e.g. closing brace) and if it's the first character of a new line
    else if (rules.decreaseIndentPattern.test(currentLine) && cursorOffset === 0) {
        newIndentLevel = Math.max(0, newIndentLevel - 1)
        // Remove the necessary amount of indentation from the current line
        const indentationToRemove = "\t".repeat(prevIndentLevel - newIndentLevel)
        nodeText = nodeText.replace(indentationToRemove, "")
    }

    // Create a new CodeLineNode with the correct indentation level
    const newCodeLineNode = $createCodeLineNode(newIndentLevel, false)
    parent.insertAfter(newCodeLineNode)

    // Add indentation to the new line
    if (newIndentLevel > 0) {
        newCodeLineNode.appendCodeHighlight("\t".repeat(newIndentLevel))
    }

    // Add remaining text if any
    if (remainingText.trim()) {
        newCodeLineNode.appendCodeHighlight(remainingText)
    }

    // Position cursor at start of new line after indentation
    newCodeLineNode.selectEnd()

    return true
}

function handleCodeLineNodeTransform(node: CodeLineNode, editor: LexicalEditor) {
    const parent = node.getParent()
    if (!$isCodeNode(parent)) return

    const selection = $getSelection()

    const language = parent.getLanguage()
    const rules = getIndentationRules(language)

    const firstChild = node.getFirstChild()
    if (!$isCodeHighlightNode(firstChild) && !$isTabNode(firstChild)) return

    const firstText = node.getTextContent().trim()?.[0]
    const currentIndentLevel = node.getIndentLevel()

    let newIndentLevel = currentIndentLevel

    // Get previous line's indent level
    const prevCodeLineNode = getPreviousCodeLineNode(node)
    const prevIndentLevel = prevCodeLineNode ? prevCodeLineNode.getIndentLevel() : 0

    // Check if we need to decrease indent (e.g. closing brace)
    if (rules.decreaseIndentPattern.test(firstText) && currentIndentLevel >= prevIndentLevel) {
        newIndentLevel = Math.max(0, currentIndentLevel - 1)
    }

    if (newIndentLevel !== currentIndentLevel) {
        if ($isRangeSelection(selection)) {
            const a = selection.anchor.getNode()
            const siblings = a.getPreviousSiblings().filter($isCodeHighlightNode)
            if (siblings.length > 0) {
                return
            }
        }

        editor.update(() => {
            node.setIndentLevel(newIndentLevel)

            // Adjust the indentation of the first child
            let indentationToRemove = currentIndentLevel - newIndentLevel
            let child = node.getFirstChild()
            while (child && indentationToRemove > 0) {
                if ($isTabNode(child)) {
                    child.remove()
                    indentationToRemove--
                }
                child = child.getNextSibling()
            }
        })
    }
}

function handleNodeCreation(node: CodeHighlightNode, editor: LexicalEditor) {
    editor.update(() => {
        const prevCodeHighlightNode = getPreviousCodeHighlightNode(node)
        const prevIndentLevel = prevCodeHighlightNode ? prevCodeHighlightNode.getIndentLevel() : 0

        node.setIndentLevel(prevIndentLevel)

        // Ensure only the first node in the line is marked as the first in line
        const prevAnyNode = node.getPreviousSibling()
        if ($isLineBreakNode(prevAnyNode) || $isTabNode(prevAnyNode) || prevAnyNode === null) {
            node.setFirstInLine(true)
        } else {
            node.setFirstInLine(false)
        }
    })
}

function getPreviousCodeHighlightNode(node: LexicalNode): CodeHighlightNode | null {
    let prevNode = node.getPreviousSibling()
    while (prevNode) {
        if ($isCodeHighlightNode(prevNode)) {
            return prevNode
        }
        prevNode = prevNode.getPreviousSibling()
    }
    return null
}

function getPreviousCodeLineNode(node: LexicalNode): CodeLineNode | null {
    let prevNode = node.getPreviousSibling()
    while (prevNode) {
        if ($isCodeLineNode(prevNode)) {
            return prevNode
        }
        prevNode = prevNode.getPreviousSibling()
    }
    return null
}

function toggleVisibility(node: CodeLineNode, hidden: boolean): void {
    node.setHidden(hidden)
}

function handleToggleCollapse(node: CodeLineNode): void {
    node.toggleCollapsed()
    const shouldCollapse = node.isCollapsed()
    let sibling = node.getNextSibling()

    while (sibling && $isCodeLineNode(sibling)) {
        if (sibling.getIndentLevel() <= node.getIndentLevel()) {
            break
        }
        toggleVisibility(sibling, shouldCollapse ? true : false)
        sibling = sibling.getNextSibling()
    }
}

export function CodeFormattingPlugin(): null {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        const unregisterEnterCommand = editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => handleLineBreak(event!, editor),
            COMMAND_PRIORITY_LOW,
        )

        const unregisterTransform = editor.registerNodeTransform(CodeLineNode, (node) =>
            handleCodeLineNodeTransform(node, editor),
        )

        const unregisterMutationListener = editor.registerMutationListener(
            CodeHighlightNode,
            (mutations) => {
                for (const [nodeKey, mutationType] of mutations) {
                    if (mutationType === "created") {
                        editor.getEditorState().read(() => {
                            const node = $getNodeByKey(nodeKey)
                            if ($isCodeHighlightNode(node)) {
                                handleNodeCreation(node, editor)
                            }
                        })
                    }
                }
            },
        )

        return () => {
            unregisterEnterCommand()
            unregisterTransform()
            unregisterMutationListener()
        }
    }, [editor])

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (target.tagName === "BUTTON") {
                const nodeKey = target.closest(".code-line")?.getAttribute("data-lexical-key")
                if (nodeKey) {
                    editor.update(() => {
                        const node = $getNodeByKey(nodeKey)
                        if (node && $isCodeLineNode(node)) {
                            handleToggleCollapse(node)
                            updateCodeGutter(node.getParent() as CodeNode, editor)
                        }
                    })
                }
            }
        }

        document.addEventListener("click", handleClick)

        return () => {
            document.removeEventListener("click", handleClick)
        }
    }, [editor])

    return null
}
