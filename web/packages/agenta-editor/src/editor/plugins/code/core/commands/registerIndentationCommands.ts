import {createLogger} from "@agenta/shared/utils"
import {$findMatchingParent, mergeRegister} from "@lexical/utils"
import {
    $addUpdateTag,
    $getSelection,
    $isRangeSelection,
    $setSelection,
    COMMAND_PRIORITY_HIGH,
    KEY_DOWN_COMMAND,
    KEY_TAB_COMMAND,
    LexicalNode,
    SKIP_SCROLL_INTO_VIEW_TAG,
    type LexicalEditor,
} from "lexical"

import {$createCodeHighlightNode, $isCodeHighlightNode} from "../../nodes/CodeHighlightNode"
import {$createCodeLineNode, $isCodeLineNode, CodeLineNode} from "../../nodes/CodeLineNode"
import {$createCodeTabNode, $isCodeTabNode} from "../../nodes/CodeTabNode"
import {getIndentCount} from "../../utils/indent"
import {$getCodeBlockForLine, $getLineCount} from "../../utils/segmentUtils"
import {ENTER_KEY_UPDATE_TAG, setEnterKeyTimestamp} from "../highlight/updateTags"

const log = createLogger("IndentationPlugin", {
    disabled: false,
})
const DEBUG_LOGS = false
const DEBUG_ENTER_TRACE = true

const LARGE_DOC_SKIP_SCROLL_THRESHOLD = 500

interface IndentationCommandOptions {
    skipScroll?: boolean
}

function getNow(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now()
    }
    return Date.now()
}

function $setCaretToLineIndent(line: CodeLineNode): void {
    const children = line.getChildren()
    const firstContentNode = children.find((node) => !$isCodeTabNode(node))
    const lastTabNode = children.filter($isCodeTabNode).pop()

    if (firstContentNode) {
        const sel = firstContentNode.selectStart()
        $setSelection(sel)
        return
    }

    if (lastTabNode) {
        const sel = lastTabNode.selectEnd()
        $setSelection(sel)
        return
    }

    const sel = line.selectStart()
    $setSelection(sel)
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

function emitEnterPostPhaseLogs(
    editorKey: string,
    enterStartMs: number,
    meta: {branch: string; targetLineKey: string},
) {
    if (!DEBUG_ENTER_TRACE) return

    queueMicrotask(() => {
        log("enterPostMicrotask", {
            editorKey,
            ...meta,
            elapsedMs: Number((getNow() - enterStartMs).toFixed(2)),
        })
    })

    setTimeout(() => {
        log("enterPostTimeout0", {
            editorKey,
            ...meta,
            elapsedMs: Number((getNow() - enterStartMs).toFixed(2)),
        })
    }, 0)

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
            log("enterPostRaf", {
                editorKey,
                ...meta,
                elapsedMs: Number((getNow() - enterStartMs).toFixed(2)),
            })
        })
    }
}

function $insertLinesAfter(baseLine: CodeLineNode, lines: CodeLineNode[]): void {
    if (lines.length === 0) {
        return
    }

    let cursor: CodeLineNode = baseLine
    for (const line of lines) {
        cursor.insertAfter(line)
        cursor = line
    }
}

export function registerIndentationCommands(
    editor: LexicalEditor,
    options: IndentationCommandOptions = {},
): () => void {
    return mergeRegister(
        editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                if (event.key !== "Enter") return false

                log("ENTER pressed", event.key)
                const enterStartMs = getNow()

                const selection = $getSelection()
                if (!$isRangeSelection(selection)) return false

                const anchor = selection.anchor
                const anchorOffset = anchor.offset

                const anchorNode = anchor.getNode()

                const lineNode = $findMatchingParent(anchorNode, $isCodeLineNode)
                if (!lineNode) return false

                const blockNode = $getCodeBlockForLine(lineNode)
                const language = blockNode ? blockNode.getLanguage() : undefined
                if (!blockNode) return false

                $addUpdateTag(ENTER_KEY_UPDATE_TAG)
                setEnterKeyTimestamp(enterStartMs)
                const absoluteOffset = $getAbsoluteOffsetInLine(lineNode, anchorNode, anchorOffset)
                const blockLineCount = $getLineCount(blockNode)

                const skipScroll =
                    options.skipScroll || blockLineCount >= LARGE_DOC_SKIP_SCROLL_THRESHOLD
                if (skipScroll) {
                    $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG)
                }

                DEBUG_ENTER_TRACE &&
                    log("enterStart", {
                        editorKey: editor.getKey(),
                        lineKey: lineNode.getKey(),
                        blockLineCount,
                        anchorOffset,
                        absoluteOffset,
                        skipScroll,
                    })

                event.preventDefault()

                const children = lineNode.getChildren()
                const beforeNodes: LexicalNode[] = []
                const afterNodes: LexicalNode[] = []
                let remainingOffset = absoluteOffset

                for (const node of children) {
                    const nodeLength = node.getTextContentSize()

                    if ($isCodeTabNode(node)) {
                        if (remainingOffset <= 0) {
                            afterNodes.push(node)
                        } else {
                            beforeNodes.push(node)
                            remainingOffset = Math.max(0, remainingOffset - nodeLength)
                        }
                        continue
                    }

                    if (!$isCodeHighlightNode(node)) {
                        if (remainingOffset <= 0) {
                            afterNodes.push(node)
                        } else if (remainingOffset >= nodeLength) {
                            beforeNodes.push(node)
                            remainingOffset -= nodeLength
                        } else {
                            beforeNodes.push(node)
                            remainingOffset = 0
                        }
                        continue
                    }

                    const text = node.getTextContent()
                    if (remainingOffset <= 0) {
                        afterNodes.push(node)
                        continue
                    }

                    if (remainingOffset >= nodeLength) {
                        beforeNodes.push(node)
                        remainingOffset -= nodeLength
                        continue
                    }

                    const splitAt = Math.max(0, Math.min(remainingOffset, text.length))
                    const before = $cloneHighlightNodeWithText(node, text.slice(0, splitAt))
                    const after = $cloneHighlightNodeWithText(node, text.slice(splitAt))
                    beforeNodes.push(before)
                    afterNodes.push(after)
                    remainingOffset = 0
                    DEBUG_LOGS && log("✂️ Split highlight node", {before, after})
                }

                const beforeText = beforeNodes.map((n) => n.getTextContent()).join("")
                const afterText = afterNodes.map((n) => n.getTextContent()).join("")
                const indentCount = getIndentCount(beforeText)

                const isBraced =
                    /[\[{(]\s*$/.test(beforeText.trim()) && /^[\]})]/.test(afterText.trim())

                const endsWithOpeningBrace =
                    /[\[{(]\s*$/.test(beforeText.trim()) ||
                    (language === "yaml" &&
                        (/:\s*$/.test(beforeText.trim()) || /-\s*$/.test(beforeText.trim())))

                DEBUG_LOGS &&
                    log("🔎 Full highlight content", {
                        fullText: beforeText + afterText,
                    })
                DEBUG_LOGS &&
                    log("🔪 Split parts", {
                        before: beforeText,
                        after: afterText,
                    })
                DEBUG_LOGS &&
                    log("Line analysis", {
                        before: beforeText,
                        after: afterText,
                        indentCount,
                        isBraced,
                    })

                const writableLine = lineNode.getWritable()
                writableLine.getChildren().forEach((child) => {
                    child.remove()
                })
                beforeNodes.forEach((n) => writableLine.append(n))

                const linesToInsert: CodeLineNode[] = []

                const createIndentedLine = (extra: number) => {
                    const line = $createCodeLineNode()
                    for (let i = 0; i < indentCount + extra; i++) {
                        const tabNode = $createCodeTabNode()
                        line.append(tabNode)
                    }
                    return line
                }

                if (isBraced) {
                    const middle = createIndentedLine(1)
                    $ensureEditableContentNode(middle)
                    linesToInsert.push(middle)
                } else if (endsWithOpeningBrace) {
                    const trailing = createIndentedLine(1)

                    if (afterNodes.length > 0) {
                        afterNodes.forEach((n) => trailing.append(n))
                        DEBUG_LOGS &&
                            log("📎 Inserted trailing content with extra indent", {
                                trailingContent: trailing.getTextContent(),
                            })
                    } else {
                        $ensureEditableContentNode(trailing)
                    }

                    $insertLinesAfter(lineNode, [trailing])
                    $setCaretToLineIndent(trailing)

                    // Manual scroll — defer to second rAF so the browser has
                    // already painted (first rAF still has dirty layout from
                    // Lexical's reconciliation; scrollIntoView there forces
                    // synchronous layout of ~65k nodes).
                    if (skipScroll) {
                        const targetLineKey = trailing.getKey()
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                const lineDOM = editor.getElementByKey(targetLineKey)
                                if (lineDOM) {
                                    lineDOM.scrollIntoView({
                                        block: "nearest",
                                        behavior: "instant",
                                    })
                                }
                            })
                        })
                    }

                    DEBUG_ENTER_TRACE &&
                        log("enterEnd", {
                            editorKey: editor.getKey(),
                            branch: "opening-brace",
                            targetLineKey: trailing.getKey(),
                            absoluteOffset,
                            beforeLength: beforeText.length,
                            afterLength: afterText.length,
                            skipScroll,
                            durationMs: Number((getNow() - enterStartMs).toFixed(2)),
                        })
                    emitEnterPostPhaseLogs(editor.getKey(), enterStartMs, {
                        branch: "opening-brace",
                        targetLineKey: trailing.getKey(),
                    })

                    return true
                }

                const trailing = createIndentedLine(0)

                if (afterNodes.length > 0) {
                    afterNodes.forEach((n) => trailing.append(n))
                    DEBUG_LOGS &&
                        log("📎 Inserted trailing content", {
                            trailingContent: trailing.getTextContent(),
                        })
                } else {
                    $ensureEditableContentNode(trailing)
                    DEBUG_LOGS &&
                        log("📎 Inserted new line content", {
                            trailingContent: trailing.getTextContent(),
                        })
                }
                linesToInsert.push(trailing)

                $insertLinesAfter(lineNode, linesToInsert)

                const selectionTarget = isBraced ? linesToInsert[0] : trailing
                $setCaretToLineIndent(selectionTarget)

                // Manual scroll — defer to second rAF so the browser has
                // already painted (first rAF still has dirty layout).
                if (skipScroll) {
                    const targetLineKey = selectionTarget.getKey()
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const lineDOM = editor.getElementByKey(targetLineKey)
                            if (lineDOM) {
                                lineDOM.scrollIntoView({
                                    block: "nearest",
                                    behavior: "instant",
                                })
                            }
                        })
                    })
                }

                DEBUG_ENTER_TRACE &&
                    log("enterEnd", {
                        editorKey: editor.getKey(),
                        branch: isBraced ? "braced" : "standard",
                        targetLineKey: selectionTarget.getKey(),
                        absoluteOffset,
                        beforeLength: beforeText.length,
                        afterLength: afterText.length,
                        insertedLines: linesToInsert.length,
                        skipScroll,
                        durationMs: Number((getNow() - enterStartMs).toFixed(2)),
                    })
                emitEnterPostPhaseLogs(editor.getKey(), enterStartMs, {
                    branch: isBraced ? "braced" : "standard",
                    targetLineKey: selectionTarget.getKey(),
                })

                return true
            },
            COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
            KEY_TAB_COMMAND,
            () => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection)) return false
                const anchor = selection.anchor
                const anchorNode = anchor.getNode()

                const lineNode = $findMatchingParent(anchorNode, $isCodeLineNode)
                if (!lineNode) return false

                const blockNode = $getCodeBlockForLine(lineNode)
                const language = blockNode ? blockNode.getLanguage() : undefined

                const selectionNodes = selection.getNodes()

                if (selectionNodes.length > 0 && $isCodeHighlightNode(selectionNodes[0])) {
                    const spaces = language === "json" || language === "yaml" ? "  " : "    "
                    selection.insertText(spaces)
                } else {
                    const newTab = $createCodeTabNode()
                    selection.insertNodes([newTab])
                }

                return true
            },
            COMMAND_PRIORITY_HIGH,
        ),
    )
}
