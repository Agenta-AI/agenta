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

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {useLexicalComposerContext} from "@agenta/ui"
import {$isCodeNode, getCodeLanguageOptions, getLanguageFriendlyName} from "@lexical/code"
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
        // Recompute after mount so existing blocks get pickers without an edit. On a cold open the
        // drawer is still sliding in and the markdown is still hydrating, so the first rects are
        // stale (the picker would otherwise only appear once some later event nudged a recompute —
        // e.g. a hover). Re-run across the next frames + a few timeouts to settle on the real rects.
        recompute()
        const raf = requestAnimationFrame(recompute)
        const timers = [60, 180, 360].map((t) => window.setTimeout(recompute, t))
        const onMove = () => recompute()
        // capture: the editor scrolls in an inner container, not the window
        window.addEventListener("scroll", onMove, true)
        window.addEventListener("resize", onMove)
        return () => {
            cancelAnimationFrame(raf)
            timers.forEach(clearTimeout)
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
                    className="fixed z-[1100] rounded-md bg-[var(--ant-color-bg-elevated)]"
                    style={{
                        top: m.top + 7,
                        right: m.right + 8,
                        fontFamily: "var(--ant-font-family)",
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <Combobox
                        value={m.lang || ""}
                        onValueChange={(lang) => setLanguage(m.key, lang)}
                        disabled={!editable}
                    >
                        <ComboboxTrigger
                            className="min-w-24 border-0 bg-transparent shadow-none data-[size=sm]:h-6 px-2"
                            size="sm"
                        >
                            <ComboboxValue placeholder="Plain text">
                                {() => (m.lang ? getLanguageFriendlyName(m.lang) : "Plain text")}
                            </ComboboxValue>
                        </ComboboxTrigger>
                        <ComboboxContent className="w-auto min-w-32" align="end">
                            <ComboboxInput placeholder="Search..." />
                            <ComboboxEmpty>No results</ComboboxEmpty>
                            {options.map((opt) => (
                                <ComboboxItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </ComboboxItem>
                            ))}
                        </ComboboxContent>
                    </Combobox>
                </div>
            ))}
        </>,
        document.body,
    )
}
