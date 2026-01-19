import {useEffect, useState, useCallback, useRef} from "react"

import {createLogger} from "@agenta/shared"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {LexicalEditor} from "lexical"

import {$isCodeBlockNode} from "../nodes/CodeBlockNode"
import {$isCodeLineNode, CodeLineNode} from "../nodes/CodeLineNode"
import {getIndentCount, isFoldableLine} from "../utils/indent"

const log = createLogger("CodeFoldingPlugin", {disabled: true})

interface LineInfo {
    key: string
    top: number
    height: number
    collapsed: boolean
    foldable: boolean
}

/**
 * Toggle the collapsed state for a line and hide/show subsequent siblings whose
 * indentation is deeper than the clicked line.
 */
function toggleFold(editor: LexicalEditor, line: CodeLineNode) {
    const isNowCollapsed = !line.isCollapsed()
    line.setCollapsed(isNowCollapsed)

    const baseIndent = getIndentCount(line.getTextContent())
    let currentLine = line.getNextSibling() as CodeLineNode | null

    let processed = 0
    while (currentLine && $isCodeLineNode(currentLine)) {
        const currIndent = getIndentCount(currentLine.getTextContent())
        if (currIndent <= baseIndent) break
        currentLine.setHidden(isNowCollapsed)
        processed += 1
        currentLine = currentLine.getNextSibling() as CodeLineNode | null
    }

    log("toggleFold processed", {processed, baseIndent})

    log("Toggled fold", {line: line.getKey(), collapsed: isNowCollapsed})
}

/**
 * Combined folding UI + logic plugin. Renders gutter buttons and manages
 * foldable metadata via a node transform.
 */
export function CodeFoldingPlugin() {
    const [editor] = useLexicalComposerContext()
    const [lines, setLines] = useState<LineInfo[]>([])
    const rootRef = useRef<HTMLElement | null>(null)

    /* -------------------------------------------------- */
    /*   Node transform – mark lines foldable             */
    /* -------------------------------------------------- */
    useEffect(() => {
        return editor.registerNodeTransform(CodeLineNode, (line) => {
            const parent = line.getParent()
            if (!$isCodeBlockNode(parent)) return
            const language = parent.getLanguage()
            const text = line.getTextContent()
            const foldable = isFoldableLine(text, language)

            if (foldable !== line.isFoldable()) {
                log("[Transform] line", {key: line.getKey(), foldable})
                line.setFoldable(foldable)
            }
            // Ensure collapsed flag resets when not foldable
            if (!foldable && line.isCollapsed()) {
                line.setCollapsed(false)
            }
        })
    }, [editor])

    /* -------------------------------------------------- */
    /*   Update listener – compute gutter positions       */
    /* -------------------------------------------------- */
    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const root = editor.getRootElement()
                if (!root) return
                if (!rootRef.current) rootRef.current = root
                const domRoot = root as HTMLElement
                const lineEls = domRoot.querySelectorAll<HTMLElement>("div.editor-code-line")
                const next: LineInfo[] = []
                lineEls.forEach((el) => {
                    const key = el.getAttribute("data-lexical-node-key") || ""
                    const node = editorState._nodeMap.get(key) as CodeLineNode | undefined
                    if (!$isCodeLineNode(node)) return
                    const rect = el.getBoundingClientRect()
                    const top = rect.top + domRoot.scrollTop - domRoot.getBoundingClientRect().top
                    const height = rect.height
                    const language =
                        ($isCodeBlockNode(node.getParent()) &&
                            (node.getParent() as any).getLanguage?.()) ||
                        "json"
                    const text = node.getTextContent()
                    const foldable = isFoldableLine(text, language)
                    next.push({
                        key,
                        top,
                        height,
                        collapsed: node.isCollapsed(),
                        foldable,
                    })
                })
                log("[Update] computed lines", next.length)
                setLines(next)
            })
        })
    }, [editor])

    /* -------------------------------------------------- */
    /*   Render gutter buttons                            */
    /* -------------------------------------------------- */
    const handleClick = useCallback(
        (lineKey: string) => {
            log("[Click] fold button", lineKey)
            editor.update(() => {
                const node = editor.getEditorState()._nodeMap.get(lineKey) as
                    | CodeLineNode
                    | undefined
                if ($isCodeLineNode(node) && node.isFoldable()) {
                    toggleFold(editor, node)
                }
            })
        },
        [editor],
    )

    if (lines.length === 0) return null

    return (
        <div style={{position: "absolute", left: 0, top: 0}}>
            {lines.map((line) => {
                return (
                    <button
                        key={line.key}
                        style={{
                            position: "absolute",
                            left: "4px",
                            top: line.top + 8,
                            width: "min-content",
                            height: line.height,
                            background: "none",
                            border: "none",
                            cursor: line.foldable ? "pointer" : "default",
                            fontSize: "10px",
                            color: "#888",
                            zIndex: 1,
                            pointerEvents: line.foldable ? "auto" : "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            margin: 0,
                        }}
                        onClick={() => handleClick(line.key)}
                    >
                        {line.foldable ? (line.collapsed ? "▸" : "▾") : ""}
                    </button>
                )
            })}
        </div>
    )
}
