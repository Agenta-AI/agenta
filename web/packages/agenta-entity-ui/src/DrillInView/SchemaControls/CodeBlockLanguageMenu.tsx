/**
 * CodeBlockLanguageMenu
 *
 * Renders a language picker pinned to the top-right of the code block the caret is in, instead of
 * in the toolbar — so the language reads as part of the block (and there can be several blocks with
 * different languages). It mounts inside the editor's `EditorProvider`. The picker drives
 * `CodeNode.setLanguage`, which Prism highlighting (registered in MarkdownEditor) reads.
 *
 * Positioning: a fixed-position portal anchored to the block's viewport rect, recomputed on every
 * editor update plus scroll/resize. While focus sits in the open dropdown (no range selection) the
 * menu stays put — it only hides when the caret moves into a non-code block.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {useLexicalComposerContext} from "@agenta/ui"
import {$isCodeNode, getCodeLanguageOptions, getLanguageFriendlyName} from "@lexical/code"
import {Select} from "antd"
import {$getNodeByKey, $getSelection, $isRangeSelection} from "lexical"
import {createPortal} from "react-dom"

interface MenuPos {
    key: string
    lang: string
    top: number
    right: number
}

export function CodeBlockLanguageMenu() {
    const [editor] = useLexicalComposerContext()
    const options = useMemo(
        () => getCodeLanguageOptions().map(([value, label]) => ({value, label})),
        [],
    )
    const [pos, setPos] = useState<MenuPos | null>(null)

    const recompute = useCallback(() => {
        editor.getEditorState().read(() => {
            const selection = $getSelection()
            // No range selection means focus left the editor (e.g. into the open dropdown) — keep
            // the menu where it is rather than flickering it away mid-interaction.
            if (!$isRangeSelection(selection)) return
            const block = selection.anchor.getNode().getTopLevelElement()
            if (!block || !$isCodeNode(block)) {
                setPos(null)
                return
            }
            const el = editor.getElementByKey(block.getKey())
            if (!el) {
                setPos(null)
                return
            }
            const rect = el.getBoundingClientRect()
            setPos({
                key: block.getKey(),
                lang: block.getLanguage() ?? "",
                top: rect.top,
                right: window.innerWidth - rect.right,
            })
        })
    }, [editor])

    useEffect(() => editor.registerUpdateListener(() => recompute()), [editor, recompute])

    useEffect(() => {
        const onMove = () => recompute()
        // capture: the editor scrolls in an inner container, not the window
        window.addEventListener("scroll", onMove, true)
        window.addEventListener("resize", onMove)
        return () => {
            window.removeEventListener("scroll", onMove, true)
            window.removeEventListener("resize", onMove)
        }
    }, [recompute])

    const setLanguage = useCallback(
        (lang: string) => {
            editor.update(() => {
                if (!pos) return
                const node = $getNodeByKey(pos.key)
                if ($isCodeNode(node)) node.setLanguage(lang)
            })
        },
        [editor, pos],
    )

    if (!pos) return null

    return createPortal(
        <div
            className={[
                "fixed z-[1100] rounded-md bg-[var(--ant-color-bg-elevated)]",
                "[&_.ant-select-selector]:!h-6 [&_.ant-select-selector]:!px-2",
                "[&_.ant-select-selection-item]:!text-[11px] [&_.ant-select-selection-item]:!leading-6",
                "[&_.ant-select-selection-placeholder]:!text-[11px] [&_.ant-select-selection-placeholder]:!leading-6",
                "[&_.ant-select-selection-search-input]:!h-6",
            ].join(" ")}
            style={{top: pos.top + 7, right: pos.right + 8}}
            // Don't let interactions here reach the editor.
            onMouseDown={(e) => e.stopPropagation()}
        >
            <Select
                showSearch
                value={pos.lang || undefined}
                placeholder="Plain text"
                options={options}
                onChange={setLanguage}
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                variant="borderless"
                className="min-w-[96px] font-sans"
                // Show the friendly name ("JavaScript") for the selected value, not the raw id.
                labelRender={({value}) =>
                    value ? getLanguageFriendlyName(String(value)) : "Plain text"
                }
            />
        </div>,
        document.body,
    )
}
