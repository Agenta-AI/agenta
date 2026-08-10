/**
 * SlashCommandPlugin — the `/` command palette above the composer.
 *
 * Opens on a `/` that starts a block or follows a space (so `and/or`, URLs, and paths never trigger
 * it), filters as the user types, and hands the selection back to the host: an `insert` item types
 * its text into the message, an `open` item closes the menu first so the host's picker owns the
 * keyboard.
 *
 * The menu registers Enter at CRITICAL because `SubmitPlugin` claims it at HIGH — without that a
 * selection would send the message. With no matches it deliberately declines Enter, so a message
 * that merely starts with a slash still sends.
 */
import {useCallback, useEffect, useId, useMemo, useRef, useState} from "react"

import {autoUpdate, flip, offset, shift, size, useFloating} from "@floating-ui/react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import clsx from "clsx"
import {
    $getSelection,
    $isRangeSelection,
    $isTextNode,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_TAB_COMMAND,
} from "lexical"
import {createPortal} from "react-dom"

import {
    filterSections,
    flattenSections,
    isSameRun,
    matchLabel,
    readCommandRun,
    type SlashCommandItem,
    type SlashCommandSection,
} from "../assets/slashCommands"

interface SlashCommandPluginProps {
    sections: SlashCommandSection[]
    /** The composer box the menu spans and sits above. */
    anchorRef: React.RefObject<HTMLElement | null>
    /** Suppresses the menu without unmounting it (e.g. while dictating). */
    disabled?: boolean
}

/** A run plus the text node it lives in — the identity a dismissal is keyed on. */
interface LocatedRun {
    query: string
    nodeKey: string
    start: number
}

export function SlashCommandPlugin({sections, anchorRef, disabled}: SlashCommandPluginProps) {
    const [editor] = useLexicalComposerContext()
    const [query, setQuery] = useState<string | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const activeRowRef = useRef<HTMLDivElement | null>(null)
    // Which run was dismissed, and which the caret sits in now. Without the latch the next caret
    // move re-derives the same run and the menu springs back, so Escape would read as broken. Keyed
    // on POSITION, not on the run's text (a retyped `/` gives an identical query) and not on mere
    // existence (that leaks the dismissal onto the next run — see `CommandRun`).
    const dismissedRef = useRef<LocatedRun | null>(null)
    const runRef = useRef<LocatedRun | null>(null)

    const open = query !== null && !disabled

    const visibleSections = useMemo(
        () => (open ? filterSections(sections, query ?? "") : []),
        [open, sections, query],
    )
    const items = useMemo(() => flattenSections(visibleSections), [visibleSections])
    const activeItem = items[activeIndex]

    const listId = useId()
    const optionId = useCallback((index: number) => `${listId}-opt-${index}`, [listId])

    const close = useCallback(() => {
        dismissedRef.current = runRef.current
        setQuery(null)
    }, [])

    // Read the caret's command run on every edit. Requiring a space (or the block start) before the
    // `/` is what keeps `and/or`, URLs, and paths from opening the menu mid-sentence.
    useEffect(() => {
        /** The command run at the caret, or null when the caret isn't in one. */
        const $readRun = (): LocatedRun | null => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
            const node = selection.anchor.getNode()
            // An emptied paragraph anchors on the element itself, not a text node.
            if (!$isTextNode(node)) return null
            const run = readCommandRun(node.getTextContent().slice(0, selection.anchor.offset))
            if (!run) return null
            // A run flush against the node start opens the menu only when it also starts the block.
            if (!run.afterSpace && node.getPreviousSibling() !== null) return null
            return {query: run.query, nodeKey: node.getKey(), start: run.start}
        }
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const next = $readRun()
                runRef.current = next
                // Every path funnels through here: moving to a different run (or none) re-arms the
                // menu, editing within the dismissed one does not. An early return above would
                // strand the latch on.
                const suppressed = isSameRun(next, dismissedRef.current)
                if (!suppressed) dismissedRef.current = null
                setQuery(!next || suppressed ? null : next.query)
            })
        })
    }, [editor])

    // A changed result set re-homes the highlight on the first row, so the footer's Enter hint and
    // the highlight never describe a row that filtering just removed.
    useEffect(() => {
        setActiveIndex(0)
    }, [query])

    useEffect(() => {
        if (activeIndex > 0 && activeIndex >= items.length) setActiveIndex(0)
    }, [activeIndex, items.length])

    const select = useCallback(
        (item: SlashCommandItem) => {
            if (item.kind === "insert") {
                const text = `${item.insertText ?? item.label} `
                editor.update(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return
                    const node = selection.anchor.getNode()
                    if (!$isTextNode(node)) return
                    // Replace the typed run ONLY — anything the user wrote before it must survive,
                    // now that a run can start mid-message.
                    const full = node.getTextContent()
                    const caret = selection.anchor.offset
                    const run = readCommandRun(full.slice(0, caret))
                    const head = full.slice(0, run ? run.start : caret)
                    const upToCaret = head + text
                    node.setTextContent(upToCaret + full.slice(caret))
                    node.select(upToCaret.length, upToCaret.length)
                })
                close()
                return
            }
            // The host clears the typed command when its picker opens.
            close()
            item.onSelect?.()
        },
        [close, editor],
    )

    // Keyboard. Registered above SubmitPlugin's HIGH so a selection never leaks through as a send.
    useEffect(() => {
        if (!open) return
        // preventDefault too: returning true only stops Lexical, the caret still moves natively.
        const move = (event: KeyboardEvent | null, delta: number) => {
            if (!items.length) return false
            event?.preventDefault()
            setActiveIndex((i) => (i + delta + items.length) % items.length)
            requestAnimationFrame(() => activeRowRef.current?.scrollIntoView({block: "nearest"}))
            return true
        }
        const unregister = [
            editor.registerCommand(
                KEY_ARROW_DOWN_COMMAND,
                (event) => move(event, 1),
                COMMAND_PRIORITY_CRITICAL,
            ),
            editor.registerCommand(
                KEY_ARROW_UP_COMMAND,
                (event) => move(event, -1),
                COMMAND_PRIORITY_CRITICAL,
            ),
            editor.registerCommand(
                KEY_ESCAPE_COMMAND,
                () => {
                    close()
                    return true
                },
                COMMAND_PRIORITY_CRITICAL,
            ),
            editor.registerCommand(
                KEY_ENTER_COMMAND,
                (event) => {
                    // Nothing matched: decline, so SubmitPlugin sends the text as written.
                    if (!activeItem) return false
                    event?.preventDefault()
                    select(activeItem)
                    return true
                },
                COMMAND_PRIORITY_CRITICAL,
            ),
            editor.registerCommand(
                KEY_TAB_COMMAND,
                (event) => {
                    if (!activeItem) return false
                    event?.preventDefault()
                    select(activeItem)
                    return true
                },
                COMMAND_PRIORITY_CRITICAL,
            ),
        ]
        return () => unregister.forEach((fn) => fn())
    }, [activeItem, close, editor, items.length, open, select])

    // The menu spans the composer and sits above it, so it reads as part of the input rather than a
    // dropdown hanging off the caret.
    const {refs, floatingStyles} = useFloating({
        open,
        placement: "top-start",
        middleware: [
            offset(8),
            flip({fallbackPlacements: ["bottom-start"]}),
            shift({padding: 8}),
            size({
                apply({rects, elements}) {
                    elements.floating.style.width = `${rects.reference.width}px`
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    })

    useEffect(() => {
        refs.setReference(open ? anchorRef.current : null)
    }, [anchorRef, open, refs])

    // Focus never leaves the editor while the palette is up, so the editor is what must name the
    // active option — without this the listbox is inert to a screen reader.
    useEffect(() => {
        const root = editor.getRootElement()
        if (!root) return
        const clear = () => {
            root.removeAttribute("aria-controls")
            root.removeAttribute("aria-activedescendant")
        }
        if (!open) {
            clear()
            return
        }
        root.setAttribute("aria-controls", listId)
        if (activeItem) root.setAttribute("aria-activedescendant", optionId(activeIndex))
        else root.removeAttribute("aria-activedescendant")
        return clear
    }, [activeIndex, activeItem, editor, listId, open, optionId])

    if (!open) return null

    let rowIndex = -1

    return createPortal(
        <div
            ref={refs.setFloating}
            id={listId}
            style={floatingStyles}
            role="listbox"
            aria-label="Commands"
            // font-portal: portaled to <body>, escaping the app font scope (preflight off).
            className="z-[1050] overflow-hidden rounded-[10px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgElevated)] font-portal shadow-overlay"
        >
            <div className="max-h-[286px] overflow-y-auto pb-1">
                {items.length === 0 ? (
                    <div className="px-4 py-[26px] text-center">
                        <div className="text-xs text-[var(--ag-colorTextSecondary)]">
                            No command or skill matches “{query}”
                        </div>
                    </div>
                ) : (
                    visibleSections.map((section) => (
                        <div key={section.key}>
                            <div className="px-[14px] pb-[5px] pt-[10px] text-[9.5px] font-semibold uppercase leading-none tracking-[.1em] text-[var(--ag-colorTextTertiary)]">
                                {section.title}
                            </div>
                            {section.items.map((item) => {
                                rowIndex += 1
                                const index = rowIndex
                                const active = index === activeIndex
                                const parts = matchLabel(item.label, query ?? "")
                                return (
                                    <div
                                        key={item.key}
                                        id={optionId(index)}
                                        ref={active ? activeRowRef : null}
                                        role="option"
                                        // The palette has no value in effect, so — unlike the
                                        // pickers it opens — the cursor IS the selection candidate.
                                        aria-selected={active}
                                        onMouseEnter={() => setActiveIndex(index)}
                                        // mousedown, not click: the editor must not lose the caret
                                        // before the selection runs.
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            select(item)
                                        }}
                                        className={clsx(
                                            "mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-md px-[9px] py-1.5",
                                            active && "bg-[var(--ag-colorFillTertiary)]",
                                        )}
                                    >
                                        {/* No reserved slot when nothing supplies an icon — an
                                            empty one just reads as a ragged left margin. */}
                                        {item.icon ? (
                                            <span
                                                className={clsx(
                                                    "flex w-4 shrink-0 justify-center",
                                                    active
                                                        ? "text-[var(--ag-colorTextSecondary)]"
                                                        : "text-[var(--ag-colorTextDisabled)]",
                                                )}
                                            >
                                                {item.icon}
                                            </span>
                                        ) : null}
                                        <span className="whitespace-nowrap font-mono text-[12.5px] font-medium leading-tight text-[var(--ag-colorText)]">
                                            {parts ? (
                                                <>
                                                    {parts.before}
                                                    {parts.match ? (
                                                        // A primary tint, not colorInfoBg — that
                                                        // token sits within a hair of the row
                                                        // background, so the match read as unmarked.
                                                        <span className="rounded-[2px] bg-[color-mix(in_srgb,var(--ag-colorPrimary)_22%,transparent)]">
                                                            {parts.match}
                                                        </span>
                                                    ) : null}
                                                    {parts.after}
                                                </>
                                            ) : (
                                                item.label
                                            )}
                                        </span>
                                        {item.description ? (
                                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-[var(--ag-colorTextTertiary)]">
                                                {item.description}
                                            </span>
                                        ) : null}
                                        {item.tail ? (
                                            <span className="ml-auto whitespace-nowrap pl-2.5 text-[10px] text-[var(--ag-colorTextTertiary)]">
                                                {item.tail}
                                            </span>
                                        ) : null}
                                    </div>
                                )
                            })}
                        </div>
                    ))
                )}
            </div>
            <div className="flex items-center gap-4 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-[13px] py-[7px] text-[10.5px] text-[var(--ag-colorTextTertiary)]">
                <HintKey keys="↑↓" label="navigate" />
                {/* Names what Enter actually does, including the empty state where the menu
                    declines it and the message sends. */}
                <HintKey
                    keys="↵"
                    label={!activeItem ? "send" : activeItem.kind === "open" ? "open" : "insert"}
                />
                <HintKey keys="esc" label="dismiss" />
            </div>
        </div>,
        document.body,
    )
}

function HintKey({keys, label}: {keys: string; label: string}) {
    return (
        <span className="flex items-center gap-[5px]">
            <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] bg-[var(--ag-colorFillTertiary)] px-1 font-mono text-[9.5px] font-medium text-[var(--ag-colorTextSecondary)]">
                {keys}
            </span>
            {label}
        </span>
    )
}
