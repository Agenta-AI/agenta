/**
 * CommandPalettePlugin — the trigger menus above the composer (`/` commands, `@` file mentions).
 *
 * ONE plugin drives every palette. Two would each claim Enter at CRITICAL and race by mount order
 * even while closed, keep divergent dismissal latches, and clobber each other's
 * `aria-activedescendant` on the single contenteditable root.
 *
 * A palette opens on a trigger that starts a block or follows a space (so `and/or`, URLs, paths and
 * `hey@agenta.ai` never trigger one), filters as the user types, and hands the selection back to the
 * host: an `insert` item types its text into the message, an `open` item closes the menu first so the
 * host's picker owns the keyboard, a `navigate` item moves the palette without closing it.
 *
 * The menu registers Enter at CRITICAL because `SubmitPlugin` claims it at HIGH — without that a
 * selection would send the message. With no matches it deliberately declines Enter, so a message
 * that merely starts with a trigger still sends.
 */
import {useCallback, useEffect, useId, useMemo, useRef, useState} from "react"

import {autoUpdate, flip, offset, shift, size, useFloating} from "@floating-ui/react"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    $createTextNode,
    $getSelection,
    $isRangeSelection,
    $isTextNode,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_TAB_COMMAND,
    type LexicalNode,
} from "lexical"
import {createPortal} from "react-dom"

import {
    filterSections,
    flattenSections,
    isSameRun,
    readRun,
    runFollowsBoundary,
    runPatternFor,
    type LocatedRun,
    type PaletteInsertAs,
    type PaletteItem,
    type PaletteSpec,
} from "../assets/palette"

import {PalettePanel} from "./PalettePanel"

interface CommandPalettePluginProps {
    palettes: PaletteSpec[]
    /** The composer box the menu spans and sits above. */
    anchorRef: React.RefObject<HTMLElement | null>
    /** Suppresses the menu without unmounting it (e.g. while dictating). */
    disabled?: boolean
}

/** Everything written before this node within its block, across formatting-split siblings. */
const $textBeforeInBlock = (node: LexicalNode): string => {
    let text = ""
    for (let prev = node.getPreviousSibling(); prev; prev = prev.getPreviousSibling()) {
        text = prev.getTextContent() + text
    }
    return text
}

export function CommandPalettePlugin({palettes, anchorRef, disabled}: CommandPalettePluginProps) {
    const [editor] = useLexicalComposerContext()
    const [run, setRun] = useState<(LocatedRun & {query: string}) | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const activeRowRef = useRef<HTMLDivElement | null>(null)
    // Which run was dismissed, and which the caret sits in now. Without the latch the next caret
    // move re-derives the same run and the menu springs back, so Escape would read as broken. Keyed
    // on PALETTE + POSITION, not on the run's text (a retyped trigger gives an identical query) and
    // not on mere existence (that leaks the dismissal onto the next run).
    const dismissedRef = useRef<LocatedRun | null>(null)
    const runRef = useRef<LocatedRun | null>(null)

    const matchers = useMemo(
        () =>
            palettes.map((spec) => ({
                spec,
                pattern: runPatternFor(spec.trigger, spec.allowSlashInQuery),
            })),
        [palettes],
    )
    const matchersRef = useRef(matchers)
    matchersRef.current = matchers

    const active = run ? palettes.find((p) => p.key === run.palette) : undefined
    const open = !!run && !!active && !disabled
    const query = run?.query ?? ""

    const visibleSections = useMemo(() => {
        if (!open || !active) return []
        return active.filterMode === "label"
            ? filterSections(active.sections, query)
            : active.sections
    }, [open, active, query])
    const items = useMemo(() => flattenSections(visibleSections), [visibleSections])
    const activeItem = items[activeIndex]

    const listId = useId()
    const optionId = useCallback((index: number) => `${listId}-opt-${index}`, [listId])

    const close = useCallback(() => {
        dismissedRef.current = runRef.current
        setRun(null)
    }, [])

    // Read the caret's run on every edit. Requiring a space (or the block start) before the trigger
    // is what keeps `and/or`, URLs, paths and email addresses from opening a menu mid-sentence.
    useEffect(() => {
        /** The run at the caret, or null when the caret isn't in one. */
        const $readCaretRun = () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
            const node = selection.anchor.getNode()
            // An emptied paragraph anchors on the element itself, not a text node.
            if (!$isTextNode(node)) return null
            const upToCaret = node.getTextContent().slice(0, selection.anchor.offset)
            const before = $textBeforeInBlock(node)
            let best: (LocatedRun & {query: string}) | null = null
            for (const {spec, pattern} of matchersRef.current) {
                const hit = readRun(upToCaret, pattern)
                if (!hit) continue
                // A run flush against the node start has to be judged against the rest of the
                // block, not the node: formatting splits a paragraph into siblings.
                if (!hit.afterSpace && !runFollowsBoundary(before)) continue
                if (!best || hit.start > best.start) {
                    best = {
                        palette: spec.key,
                        query: hit.query,
                        nodeKey: node.getKey(),
                        start: hit.start,
                    }
                }
            }
            return best
        }
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const next = $readCaretRun()
                runRef.current = next
                // Every path funnels through here: moving to a different run (or none) re-arms the
                // menu, editing within the dismissed one does not. An early return above would
                // strand the latch on.
                const suppressed = isSameRun(next, dismissedRef.current)
                if (!suppressed) dismissedRef.current = null
                setRun(!next || suppressed ? null : next)
            })
        })
    }, [editor])

    // Report the query to whichever host owns this palette's data. Guarded on the last VALUE
    // emitted: a host that rebuilds its spec in response would otherwise feed this effect a new
    // identity and have its own query echoed straight back at it.
    const emittedRef = useRef<{palette: string; query: string | null}>({palette: "", query: null})
    useEffect(() => {
        const next = {palette: run?.palette ?? "", query: run?.query ?? null}
        if (emittedRef.current.palette === next.palette && emittedRef.current.query === next.query)
            return
        emittedRef.current = next
        for (const {spec} of matchersRef.current) {
            spec.onQueryChange?.(spec.key === next.palette ? next.query : null)
        }
    }, [run])

    // A changed result set re-homes the highlight on the first row, so the footer's Enter hint and
    // the highlight never describe a row that filtering just removed.
    useEffect(() => {
        setActiveIndex(0)
    }, [run?.palette, run?.query])

    useEffect(() => {
        if (activeIndex > 0 && activeIndex >= items.length) setActiveIndex(0)
    }, [activeIndex, items.length])

    /**
     * Swap the run the caret sits in for `text`. EVERY kind goes through this — an `insert` puts its
     * slug there, an `open`/`action` puts nothing — because the surrounding message must survive
     * either way, now that a run can start mid-sentence. The host must not clear the composer
     * instead: `hello /model` would lose `hello`.
     *
     * `as: "code"` writes an inline-code node rather than literal backticks: `$convertToMarkdownString`
     * escapes a typed backtick in unformatted text, so a path written as plain text would ship as
     * `\`a/b.md\`` and never resolve to a file chip.
     */
    const replaceRun = useCallback(
        (text: string, as: PaletteInsertAs = "text") => {
            editor.update(() => {
                const selection = $getSelection()
                if (!$isRangeSelection(selection)) return
                const node = selection.anchor.getNode()
                if (!$isTextNode(node)) return
                const full = node.getTextContent()
                const caret = selection.anchor.offset
                const matcher = matchersRef.current.find(
                    (m) => m.spec.key === runRef.current?.palette,
                )
                const hit = matcher ? readRun(full.slice(0, caret), matcher.pattern) : null
                const start = hit ? hit.start : caret
                if (as === "text") {
                    const upToCaret = full.slice(0, start) + text
                    node.setTextContent(upToCaret + full.slice(caret))
                    node.select(upToCaret.length, upToCaret.length)
                    return
                }
                node.setTextContent(full.slice(0, start) + full.slice(caret))
                const code = $createTextNode(text)
                code.setFormat("code")
                // A separate unformatted node, or the caret stays inside the code span and the next
                // word typed joins it — as would a second reference inserted after it. Spliced by
                // hand rather than through `insertNodes`, which folds the spacer into the span.
                const spacer = $createTextNode(" ")
                if (start === 0) node.insertBefore(code)
                else if (start >= node.getTextContentSize()) node.insertAfter(code)
                else node.splitText(start)[0].insertAfter(code)
                code.insertAfter(spacer)
                spacer.select(1, 1)
            })
        },
        [editor],
    )

    const select = useCallback(
        (item: PaletteItem) => {
            // `navigate` moves the palette (into a folder); the run and the menu both stay put.
            if (item.kind === "navigate") {
                item.onSelect?.()
                return
            }
            const as = item.kind === "insert" ? (item.insertAs ?? "text") : "text"
            const text = item.kind === "insert" ? (item.insertText ?? item.label) : ""
            // `code` gets its trailing space from the spacer node instead, or the space lands
            // inside the span and ships as part of the path.
            replaceRun(as === "code" || !text ? text : `${text} `, as)
            close()
            if (item.kind !== "insert") item.onSelect?.()
        },
        [close, replaceRun],
    )

    const drillIn = useCallback(
        (item: PaletteItem) => {
            if (!item.onDrillIn) {
                select(item)
                return
            }
            item.onDrillIn()
            // Entering a level clears what was typed, so the new level lists rather than filters.
            // Rewriting the run to the bare trigger leaves `start` where it was, so the dismissal
            // latch still names the same run.
            if (active) replaceRun(active.trigger, "text")
            setActiveIndex(0)
        },
        [active, replaceRun, select],
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
                    // A palette that stepped back a level consumes Escape without closing — and
                    // without latching, so the run stays live for the next press.
                    if (active?.onEscape?.()) return true
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
                    drillIn(activeItem)
                    return true
                },
                COMMAND_PRIORITY_CRITICAL,
            ),
        ]
        return () => unregister.forEach((fn) => fn())
    }, [active, activeItem, close, drillIn, editor, items.length, open, select])

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

    if (!open || !active) return null

    return createPortal(
        <PalettePanel
            listId={listId}
            label={active.label}
            query={query}
            sections={visibleSections}
            activeIndex={activeIndex}
            activeRowRef={activeRowRef}
            optionId={optionId}
            onHover={setActiveIndex}
            onSelect={select}
            onDrillIn={drillIn}
            header={active.header}
            footer={active.footer?.(activeItem)}
            loading={active.loading}
            emptyText={active.emptyText?.(query)}
            floatingRef={refs.setFloating}
            floatingStyles={floatingStyles}
        />,
        document.body,
    )
}
