/**
 * CodeBlockLanguageMenu
 *
 * Renders a language picker pinned to the top-right of EVERY code block in the editor (not only the
 * focused one), so each block's reserved top strip always carries its language instead of leaving a
 * dead gap. It mounts inside the editor's `EditorProvider`. The picker drives `CodeNode.setLanguage`,
 * which the Prism highlighter (registered in MarkdownEditor) reads.
 *
 * Positioning: fixed-position portals anchored to each block's viewport rect, recomputed on every
 * editor update plus scroll/resize. Pickers whose block has scrolled out of the editor's scroll
 * viewport are dropped so they don't float over the toolbar or neighbouring UI.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {useLexicalComposerContext} from "@agenta/ui"
import {$isCodeNode, getCodeLanguageOptions, getLanguageFriendlyName} from "@lexical/code"
import {Select} from "antd"
import {$getNodeByKey, $getRoot} from "lexical"
import {createPortal} from "react-dom"

interface BlockMenu {
    key: string
    lang: string
    top: number
    right: number
}

export function CodeBlockLanguageMenu({editable = true}: {editable?: boolean}) {
    const [editor] = useLexicalComposerContext()
    const options = useMemo(
        () => getCodeLanguageOptions().map(([value, label]) => ({value, label})),
        [],
    )
    const [menus, setMenus] = useState<BlockMenu[]>([])

    const recompute = useCallback(() => {
        const rootEl = editor.getRootElement()
        // `.md-prose` is the editor's scrolling viewport (see MarkdownEditor) — clip pickers to it.
        const viewport = rootEl?.closest<HTMLElement>(".md-prose")?.getBoundingClientRect()
        editor.getEditorState().read(() => {
            const next: BlockMenu[] = []
            for (const child of $getRoot().getChildren()) {
                if (!$isCodeNode(child)) continue
                const el = editor.getElementByKey(child.getKey())
                if (!el) continue
                const rect = el.getBoundingClientRect()
                // Skip blocks whose top edge isn't within the visible viewport.
                if (viewport && (rect.top < viewport.top - 4 || rect.top > viewport.bottom - 10)) {
                    continue
                }
                next.push({
                    key: child.getKey(),
                    lang: child.getLanguage() ?? "",
                    top: rect.top,
                    right: window.innerWidth - rect.right,
                })
            }
            setMenus(next)
        })
    }, [editor])

    useEffect(() => editor.registerUpdateListener(() => recompute()), [editor, recompute])

    useEffect(() => {
        // Recompute after mount so existing blocks get pickers without an edit.
        recompute()
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
        (key: string, lang: string) => {
            editor.update(() => {
                const node = $getNodeByKey(key)
                if ($isCodeNode(node)) node.setLanguage(lang)
            })
        },
        [editor],
    )

    if (!menus.length) return null

    return createPortal(
        <>
            {menus.map((m) => (
                <div
                    key={m.key}
                    className={[
                        "fixed z-[1100] rounded-md bg-[var(--ant-color-bg-elevated)]",
                        "[&_.ant-select-selector]:!h-6 [&_.ant-select-selector]:!px-2",
                        "[&_.ant-select-selection-item]:!text-[11px] [&_.ant-select-selection-item]:!leading-6",
                        "[&_.ant-select-selection-placeholder]:!text-[11px] [&_.ant-select-selection-placeholder]:!leading-6",
                        "[&_.ant-select-selection-search-input]:!h-6",
                    ].join(" ")}
                    style={{top: m.top + 7, right: m.right + 8}}
                    // Don't let interactions here reach the editor.
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <Select
                        showSearch
                        disabled={!editable}
                        value={m.lang || undefined}
                        placeholder="Plain text"
                        options={options}
                        onChange={(lang) => setLanguage(m.key, lang)}
                        optionFilterProp="label"
                        popupMatchSelectWidth={false}
                        variant="borderless"
                        className="min-w-[96px] font-sans"
                        // Show the friendly name ("JavaScript") for the selected value, not the raw id.
                        labelRender={({value}) =>
                            value ? getLanguageFriendlyName(String(value)) : "Plain text"
                        }
                    />
                </div>
            ))}
        </>,
        document.body,
    )
}
