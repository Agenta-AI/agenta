import {createLogger} from "@agenta/shared/utils"
import {$findMatchingParent} from "@lexical/utils"
import {
    $addUpdateTag,
    $createRangeSelection,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_DOWN_COMMAND,
    LexicalNode,
    SKIP_SCROLL_INTO_VIEW_TAG,
    type LexicalEditor,
} from "lexical"

import {$createCodeHighlightNode, $isCodeHighlightNode} from "../../nodes/CodeHighlightNode"
import {$createCodeLineNode, $isCodeLineNode, CodeLineNode} from "../../nodes/CodeLineNode"
import {$isCodeTabNode} from "../../nodes/CodeTabNode"
import {$getCodeBlockForLine, $getLineCount} from "../../utils/segmentUtils"
import {ENTER_KEY_UPDATE_TAG, setEnterKeyTimestamp} from "../highlight/updateTags"

const log = createLogger("BasicEnterCommand", {disabled: true})
const DEBUG_ENTER_COMMAND_PROFILE = true

/**
 * Line count above which we skip Lexical's built-in scroll-into-view
 * (which forces synchronous getBoundingClientRect on every scrollable
 * ancestor) and handle scroll manually in a rAF instead.
 */
const LARGE_DOC_SKIP_SCROLL_THRESHOLD = 500

declare global {
    interface Window {
        __AGENTA_EDITOR_ENTER_DEBUG__?: boolean
    }
}

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

function isEnterDebugEnabled(): boolean {
    if (DEBUG_ENTER_COMMAND_PROFILE) {
        return true
    }
    if (typeof window === "undefined") {
        return false
    }
    return window.__AGENTA_EDITOR_ENTER_DEBUG__ === true
}

function $setCaretToLineStart(line: CodeLineNode): void {
    const children = line.getChildren()
    const firstContentNode = children.find((node) => !$isCodeTabNode(node))
    const lastTabNode = children.filter($isCodeTabNode).pop()

    if (firstContentNode) {
        $setSelection(firstContentNode.selectStart())
        return
    }

    if (lastTabNode) {
        $setSelection(lastTabNode.selectEnd())
        return
    }

    $setSelection(line.selectStart())
}

function $ensureEditableContentNode(line: CodeLineNode): void {
    const hasContentNode = line.getChildren().some((node) => !$isCodeTabNode(node))
    if (!hasContentNode) {
        line.append($createCodeHighlightNode("", "plain", false, null))
    }
}

function $cloneHighlightNodeWithText(
    node: ReturnType<typeof $createCodeHighlightNode>,
    text: string,
) {
    const clone = $createCodeHighlightNode(
        text,
        node.getHighlightType(),
        node.hasValidationError(),
        node.getValidationMessage(),
    )
    const style = node.getStyle()
    if (style) {
        clone.setStyle(style)
    }
    return clone
}

function $createFallbackTextNode(text: string): LexicalNode {
    return $createCodeHighlightNode(text, "plain", false, null)
}

function $splitNodeAtOffset(node: LexicalNode, splitAt: number): [LexicalNode, LexicalNode] {
    const text = node.getTextContent()
    const beforeText = text.slice(0, splitAt)
    const afterText = text.slice(splitAt)

    if ($isCodeHighlightNode(node)) {
        return [
            $cloneHighlightNodeWithText(node, beforeText),
            $cloneHighlightNodeWithText(node, afterText),
        ]
    }

    return [$createFallbackTextNode(beforeText), $createFallbackTextNode(afterText)]
}

function $getAbsoluteOffsetInLine(
    line: CodeLineNode,
    anchorNode: LexicalNode,
    anchorOffset: number,
): number {
    const children = line.getChildren()

    if (anchorNode.getKey() === line.getKey()) {
        const childIndex = Math.max(0, Math.min(anchorOffset, children.length))
        let absoluteOffset = 0
        for (let i = 0; i < childIndex; i++) {
            absoluteOffset += children[i]?.getTextContentSize() ?? 0
        }
        return absoluteOffset
    }

    let absoluteOffset = 0
    for (const child of children) {
        if (child.getKey() === anchorNode.getKey()) {
            const childOffset = Math.max(0, Math.min(anchorOffset, child.getTextContentSize()))
            return absoluteOffset + childOffset
        }
        absoluteOffset += child.getTextContentSize()
    }

    const anchorLineChild = $findMatchingParent(anchorNode, (node) => node.getParent() === line)
    if (anchorLineChild) {
        let childOffsetFromStart = 0
        for (const child of children) {
            if (child.getKey() === anchorLineChild.getKey()) {
                const childOffset = Math.max(
                    0,
                    Math.min(anchorOffset, anchorLineChild.getTextContentSize()),
                )
                return childOffsetFromStart + childOffset
            }
            childOffsetFromStart += child.getTextContentSize()
        }
    }

    return absoluteOffset
}

export function registerBasicEnterCommands(editor: LexicalEditor): () => void {
    return editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
            if (event.key !== "Enter") {
                return false
            }

            const profileEnabled = isEnterDebugEnabled()
            const enterStartedAtMs = getNow()

            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                return false
            }

            const anchor = selection.anchor
            const anchorNode = anchor.getNode()
            const anchorOffset = anchor.offset

            const lineNode = $findMatchingParent(anchorNode, $isCodeLineNode)
            if (!lineNode) {
                return false
            }

            const blockNode = $getCodeBlockForLine(lineNode)
            if (!blockNode) {
                return false
            }

            const blockLineCount = $getLineCount(blockNode)

            if (profileEnabled) {
                const nodeMapSize = (
                    editor.getEditorState() as unknown as {_nodeMap?: Map<string, unknown>}
                )._nodeMap?.size
                log("enterStart", {
                    editorKey: editor.getKey(),
                    lineKey: lineNode.getKey(),
                    blockLineCount,
                    anchorOffset,
                    nodeMapSize: nodeMapSize ?? null,
                })
            }

            event.preventDefault()
            $addUpdateTag(ENTER_KEY_UPDATE_TAG)
            setEnterKeyTimestamp(enterStartedAtMs)

            // For large documents, skip Lexical's built-in scroll-into-view.
            // It calls getBoundingClientRect() on the cursor target + every
            // scrollable ancestor, forcing synchronous layout on a huge DOM.
            // We handle scroll manually in a rAF after reconciliation instead.
            const skipScroll = blockLineCount >= LARGE_DOC_SKIP_SCROLL_THRESHOLD
            if (skipScroll) {
                $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG)
            }

            const absoluteOffset = $getAbsoluteOffsetInLine(lineNode, anchorNode, anchorOffset)
            const children = lineNode.getChildren()
            const beforeNodes: LexicalNode[] = []
            const afterNodes: LexicalNode[] = []
            let remainingOffset = absoluteOffset

            for (const node of children) {
                const nodeLength = node.getTextContentSize()

                if (remainingOffset <= 0) {
                    afterNodes.push(node)
                    continue
                }

                if (remainingOffset >= nodeLength) {
                    beforeNodes.push(node)
                    remainingOffset -= nodeLength
                    continue
                }

                const splitAt = Math.max(0, Math.min(remainingOffset, nodeLength))
                const [before, after] = $splitNodeAtOffset(node, splitAt)
                beforeNodes.push(before)
                afterNodes.push(after)
                remainingOffset = 0
            }

            const writableLine = lineNode.getWritable()
            writableLine.getChildren().forEach((child) => {
                child.remove()
            })
            beforeNodes.forEach((node) => writableLine.append(node))
            $ensureEditableContentNode(writableLine)

            const trailingLine = $createCodeLineNode()
            afterNodes.forEach((node) => trailingLine.append(node))
            $ensureEditableContentNode(trailingLine)

            lineNode.insertAfter(trailingLine)

            // Set selection synchronously — cursor appears in the same frame.
            const firstChild = trailingLine.getFirstChild()
            if (firstChild) {
                const nextSelection = $createRangeSelection()
                nextSelection.anchor.set(firstChild.getKey(), 0, "text")
                nextSelection.focus.set(firstChild.getKey(), 0, "text")
                $setSelection(nextSelection)
            } else {
                $setCaretToLineStart(trailingLine)
            }

            // Manual scroll — replaces Lexical's synchronous
            // getBoundingClientRect chain that forces layout on the full DOM.
            // Defer to a SECOND rAF so the browser has already painted the
            // frame (first rAF may still have a dirty layout from Lexical's
            // reconciliation).  scrollIntoView in the first rAF forces a
            // synchronous layout of the entire DOM (~1100ms on 65k nodes).
            if (skipScroll) {
                const targetLineKey = trailingLine.getKey()
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        const lineDOM = editor.getElementByKey(targetLineKey)
                        if (lineDOM) {
                            lineDOM.scrollIntoView({block: "nearest", behavior: "instant"})
                        }
                    })
                })
            }

            if (profileEnabled) {
                const _nodeMapSizeAfter = (
                    editor.getEditorState() as unknown as {_nodeMap?: Map<string, unknown>}
                )._nodeMap?.size
                // // console.log("enterEnd", {
                //     editorKey: editor.getKey(),
                //     targetLineKey: trailingLine.getKey(),
                //     blockLineCount: $getLineCount(blockNode),
                //     nodeMapSize: nodeMapSizeAfter ?? null,
                //     skipScroll,
                //     elapsedMs: Number((getNow() - enterStartedAtMs).toFixed(2)),
                // })

                // Mark for Performance panel timeline
                performance.mark("agenta-enter-handler-end")

                // queueMicrotask(() => {
                //     performance.mark("agenta-enter-postmicrotask")
                //     // console.log("enterPostMicrotask", {
                //     //     editorKey: editor.getKey(),
                //     //     targetLineKey: trailingLine.getKey(),
                //     //     elapsedMs: Number((getNow() - enterStartedAtMs).toFixed(2)),
                //     // })
                // })

                if (
                    typeof window !== "undefined" &&
                    typeof window.requestAnimationFrame === "function"
                ) {
                    // window.requestAnimationFrame(() => {
                    //     performance.mark("agenta-enter-postraf")
                    //     // console.log("enterPostRaf", {
                    //         editorKey: editor.getKey(),
                    //         targetLineKey: trailingLine.getKey(),
                    //         elapsedMs: Number((getNow() - enterStartedAtMs).toFixed(2)),
                    //     })
                    // })
                }
            }

            return true
        },
        COMMAND_PRIORITY_HIGH,
    )
}
