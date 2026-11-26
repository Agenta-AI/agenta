import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentType,
    type KeyboardEvent,
    type ReactNode,
} from "react"

import {
    ViewEntryContext,
    ViewFooterStartContext,
    ViewStackContext,
    type ViewEntryApi,
} from "./context"
import {useReportOpenViewItem} from "./openItem"
import {useSystemBack} from "./systemBack"
import type {
    ViewChromeProps,
    ViewDef,
    ViewForm,
    ViewNav,
    ViewSaveResult,
    ViewStack,
    ViewTarget,
} from "./types"

interface Entry {
    /** Unique per open; a new key remounts the view, which drops its local form. */
    key: number
    view: ViewDef<unknown>
    params: unknown
    target: ViewTarget
    /** What had focus when the view opened; it gets focus back when the view leaves. */
    returnFocus: HTMLElement | null
}

/** How a dirty form was settled before an action: nothing to settle, dropped, or saved. */
type Settled = "clean" | "discarded" | "saved"

const MENU_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

// Unique per open across hosts, so a reopened view mounts fresh. Never stored.
let lastEntryKey = 0
const newEntry = (
    view: ViewDef<unknown>,
    params: unknown,
    target: ViewTarget,
    returnFocus: HTMLElement | null,
): Entry => ({
    key: ++lastEntryKey,
    view,
    params,
    target,
    returnFocus,
})
/** What opens a view: the focused element, or the trigger of the menu that holds it. */
const focusedElement = (): HTMLElement | null => {
    if (typeof document === "undefined") return null
    const active = document.activeElement as HTMLElement | null
    const triggerId = active?.closest?.('[role="menu"]')?.getAttribute("aria-labelledby")
    return (triggerId && document.getElementById(triggerId)) || active
}
/** The same view under a new key: it mounts again from the saved data, with no local edits. */
const remount = (entry: Entry): Entry => ({...entry, key: ++lastEntryKey})

/**
 * Owns the view stack of one container. `children` is the root: it stays mounted (hidden) while
 * a view is open, so it keeps its state. Each open view stays mounted while a child covers it,
 * so a picker never drops its parent's form.
 */
export const ViewStackHost = ({
    chrome: Chrome,
    rootTitle,
    onEscapeAtRoot,
    phone = false,
    children,
}: {
    chrome: ComponentType<ViewChromeProps>
    /** The first crumb (for example the tab name). Without it the breadcrumb starts at the first view. */
    rootTitle?: string
    /** Escape with an empty stack: the panel closes itself; a page passes nothing. */
    onEscapeAtRoot?: () => void
    /**
     * The container is a phone screen: it applies `readOnlyOnPhone` (the view gets `readOnly`),
     * and the browser back closes the top view. The container still picks its chrome.
     */
    phone?: boolean
    children: ReactNode
}) => {
    const [entries, setEntries] = useState<Entry[]>([])
    const [forms, setForms] = useState<Record<number, ViewForm>>({})
    const [titles, setTitles] = useState<Record<number, string>>({})
    // The chrome's action row slot for the top view's `ViewFooterStart`.
    const [footerStart, setFooterStart] = useState<HTMLElement | null>(null)
    const [saving, setSaving] = useState(false)
    const [failedKey, setFailedKey] = useState<number | null>(null)
    // The root animates only when a view gives it back its place, not on the first paint.
    const [viewOpened, setViewOpened] = useState(false)
    if (entries.length > 0 && !viewOpened) setViewOpened(true)

    // Refs mirror the state for the async actions, which must read the latest values.
    const entriesRef = useRef(entries)
    entriesRef.current = entries
    const formsRef = useRef(forms)
    formsRef.current = forms
    const savingRef = useRef<Promise<ViewSaveResult> | null>(null)
    // One guarded navigation at a time, from its first wait to its stack update.
    const navigatingRef = useRef(false)
    // A view that left by itself (`nav.cancel()`) while a save ran: it leaves
    // once that ends, if it is still on top.
    const deferredCancelRef = useRef<number | null>(null)
    const hostRef = useRef<HTMLDivElement>(null)
    // Set when the top view leaves: where focus goes once the view below shows.
    const pendingFocusRef = useRef<HTMLElement | null | undefined>(undefined)

    /** Navigation waits for a save in flight to resolve. */
    const waitForSave = useCallback(async () => {
        while (savingRef.current) await savingRef.current
    }, [])

    /**
     * One save at a time; a second call while one runs is ignored (resolves false). A failure
     * from the Save button marks the view. "stay" is a step
     * that worked: no failure, and the view stays.
     */
    const runSave = useCallback(
        async (entryKey: number, markFailure: boolean): Promise<ViewSaveResult> => {
            const form = formsRef.current[entryKey]
            if (!form || savingRef.current) return false
            const run = (async () => {
                try {
                    return await form.save()
                } catch {
                    return false
                }
            })()
            savingRef.current = run
            setSaving(true)
            setFailedKey(null)
            const result = await run
            savingRef.current = null
            setSaving(false)
            if (result === false && markFailure) setFailedKey(entryKey)
            return result
        },
        [],
    )

    /** Leaving never asks: a dirty form among `scope` is dropped. */
    const settle = useCallback(
        async (scope: Entry[]): Promise<Settled | false> =>
            scope.some((entry) => formsRef.current[entry.key]?.dirty) ? "discarded" : "clean",
        [],
    )

    /** Set the whole stack. Forms and titles of views that leave go with them. */
    const setStack = useCallback((next: Entry[]) => {
        const kept = new Set(next.map((entry) => entry.key))
        const keep = <T,>(prev: Record<number, T>) => {
            const out: Record<number, T> = {}
            for (const [key, value] of Object.entries(prev)) {
                if (kept.has(Number(key))) out[Number(key)] = value
            }
            return out
        }
        setForms(keep)
        setTitles(keep)
        const prev = entriesRef.current
        // Going back: focus returns to the opener of the lowest view that leaves.
        if (next.length < prev.length && next.every((entry, index) => entry === prev[index])) {
            pendingFocusRef.current = prev[next.length].returnFocus
        }
        entriesRef.current = next
        setEntries(next)
        setFailedKey(null)
    }, [])

    /** Run a cancel that arrived while a save ran, if its view is still on top. */
    const flushDeferredCancel = useCallback(() => {
        const key = deferredCancelRef.current
        deferredCancelRef.current = null
        const current = entriesRef.current
        if (key !== null && current.at(-1)?.key === key) setStack(current.slice(0, -1))
    }, [setStack])

    /**
     * Runs one guarded navigation. Another one asked for meanwhile (a second click while the
     * a save runs) is dropped and resolves false.
     */
    const exclusive = useCallback(
        async (action: () => Promise<boolean>) => {
            if (navigatingRef.current) return false
            navigatingRef.current = true
            try {
                await waitForSave()
                return await action()
            } finally {
                navigatingRef.current = false
                flushDeferredCancel()
            }
        },
        [waitForSave, flushDeferredCancel],
    )

    const open = useCallback(
        <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
            const opener = focusedElement()
            return exclusive(async () => {
                if (!(await settle(entriesRef.current))) return false
                setStack([newEntry(view as ViewDef<unknown>, params, target, opener)])
                return true
            })
        },
        [exclusive, settle, setStack],
    )

    const closeAll = useCallback(
        () =>
            exclusive(async () => {
                if (entriesRef.current.length === 0) return true
                if (!(await settle(entriesRef.current))) return false
                setStack([])
                return true
            }),
        [exclusive, settle, setStack],
    )

    /**
     * Guarded back from the top view: only the top view's own form asks. Tied to the view that
     * was on top when it was asked for, so a back held behind a save does not pop a second view.
     */
    const back = useCallback(() => {
        const requester = entriesRef.current.at(-1)?.key
        return exclusive(async () => {
            const current = entriesRef.current
            if (current.length === 0) return true
            if (current.at(-1)?.key !== requester) return false
            if (!(await settle(current.slice(-1)))) return false
            setStack(current.slice(0, -1))
            return true
        })
    }, [exclusive, settle, setStack])

    const cancel = useCallback(() => {
        if (savingRef.current || navigatingRef.current) {
            deferredCancelRef.current = entriesRef.current.at(-1)?.key ?? null
            return
        }
        setStack(entriesRef.current.slice(0, -1))
    }, [setStack])

    /**
     * One editable form at a time: a child with its own form needs a clean parent. A picker
     * ("immediate") opens over the dirty parent, which keeps its edits. After Save or Discard the
     * parent mounts again, so no stale dirty form stays under the child. False: kept editing.
     */
    const parentForChild = useCallback(
        async (parent: Entry, child: ViewDef<unknown>): Promise<Entry | false> => {
            if (child.apply !== "on_save") return parent
            const settled = await settle([parent])
            if (!settled) return false
            return settled === "clean" ? parent : remount(parent)
        },
        [settle],
    )

    const push = useCallback(
        <C,>(parentKey: number, view: ViewDef<C>, params: C, target: ViewTarget) => {
            const opener = focusedElement()
            return exclusive(async () => {
                const current = entriesRef.current
                if (current.length !== 1 || current[0].key !== parentKey) return false
                const parent = await parentForChild(current[0], view as ViewDef<unknown>)
                if (!parent) return false
                setStack([parent, newEntry(view as ViewDef<unknown>, params, target, opener)])
                return true
            })
        },
        [exclusive, parentForChild, setStack],
    )

    /**
     * The view `entryKey` gives its place to a new view at the same depth. Its own form asks
     * first; at depth 2 a new view with a form also needs a clean parent, as `push` does.
     */
    const replace = useCallback(
        <C,>(entryKey: number, view: ViewDef<C>, params: C, target: ViewTarget) =>
            exclusive(async () => {
                const current = entriesRef.current
                if (current.at(-1)?.key !== entryKey) return false
                if (!(await settle(current.slice(-1)))) return false
                const parents: Entry[] = []
                if (current.length === 2) {
                    const parent = await parentForChild(current[0], view as ViewDef<unknown>)
                    if (!parent) return false
                    parents.push(parent)
                }
                // The new view takes the place, and the opener, of the one it replaces.
                const opener = current.at(-1)?.returnFocus ?? null
                setStack([...parents, newEntry(view as ViewDef<unknown>, params, target, opener)])
                return true
            }),
        [exclusive, settle, parentForChild, setStack],
    )

    const save = useCallback(async () => {
        const top = entriesRef.current.at(-1)
        if (!top || navigatingRef.current) return
        if ((await runSave(top.key, true)) === true) {
            deferredCancelRef.current = null
            setStack(entriesRef.current.filter((entry) => entry.key !== top.key))
            return
        }
        flushDeferredCancel()
    }, [runSave, setStack, flushDeferredCancel])

    // On a phone each open view is a level of the browser back, guarded like the back arrow.
    useSystemBack(phone ? entries.length : 0, "view", back)

    const dirty = saving || Object.values(forms).some((form) => form.dirty)
    const depth = entries.length as 0 | 1 | 2
    useReportOpenViewItem(entries, titles)

    const stack = useMemo<ViewStack>(
        () => ({open, closeAll, back, dirty, depth}),
        [open, closeAll, back, dirty, depth],
    )

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        // An open menu, popover or dialog inside the views closes first; it handles its own
        // Escape. A dialog or drawer that holds the whole host does not count.
        const layer = (event.target as HTMLElement | null)?.closest?.(MENU_SELECTOR)
        if (layer && !(hostRef.current && layer.contains(hostRef.current))) return
        const top = entriesRef.current.at(-1)
        if (top) {
            event.preventDefault()
            // Like the header: a step inside the view goes back first.
            const stepBack = formsRef.current[top.key]?.back
            if (!stepBack) {
                void back()
                return
            }
            stepBack()
            // The step that had focus may be gone; the view keeps it so the next Escape works.
            requestAnimationFrame(() => {
                const host = hostRef.current
                if (host && !host.contains(document.activeElement)) {
                    host.querySelector<HTMLElement>("[data-view-top]")?.focus({preventScroll: true})
                }
            })
            return
        }
        if (onEscapeAtRoot) {
            event.preventDefault()
            onEscapeAtRoot()
        }
    }

    // After a back, focus returns to what opened the view that left, else to the view now on top.
    useEffect(() => {
        const target = pendingFocusRef.current
        if (target === undefined) return
        pendingFocusRef.current = undefined
        const host = hostRef.current
        if (target?.isConnected && host?.contains(target)) target.focus({preventScroll: true})
        if (target && document.activeElement === target) return
        host?.querySelector<HTMLElement>("[data-view-top]")?.focus({preventScroll: true})
    }, [entries])

    const top = entries.at(-1)
    const topForm = top ? forms[top.key] : undefined
    const crumbs: ViewChromeProps["crumbs"] = [
        ...(rootTitle !== undefined ? [{title: rootTitle, onSelect: () => void closeAll()}] : []),
        ...entries.map((entry, index) => ({
            title: titles[entry.key] ?? "",
            onSelect: index < entries.length - 1 ? () => void back() : undefined,
        })),
    ]

    return (
        <ViewStackContext.Provider value={stack}>
            <div ref={hostRef} className="contents" onKeyDown={onKeyDown}>
                {/* Back at the root, its content fades and slides in like any view (MOTION-01). */}
                <div
                    className={viewOpened ? "ag-view-enter-children" : undefined}
                    style={{display: top ? "none" : "contents"}}
                >
                    {children}
                </div>
                {top ? (
                    <Chrome
                        crumbs={crumbs}
                        apply={top.view.apply}
                        hideActionRow={
                            (phone && Boolean(top.view.readOnlyOnPhone)) ||
                            top.view.actionRow === false ||
                            topForm?.actionRow === false
                        }
                        showBack={Boolean(topForm?.back)}
                        form={
                            topForm ? {...topForm, saving, saveFailed: failedKey === top.key} : null
                        }
                        footerStartRef={setFooterStart}
                        onBack={topForm?.back ?? (() => void back())}
                        onCancel={topForm?.cancel ?? cancel}
                        onSave={() => void save()}
                    >
                        {entries.map((entry, index) => (
                            <MountedView
                                key={entry.key}
                                entry={entry}
                                isTop={entry === top}
                                saving={saving}
                                depth={(index + 1) as 1 | 2}
                                readOnly={phone && Boolean(entry.view.readOnlyOnPhone)}
                                footerStart={entry === top ? footerStart : null}
                                setForms={setForms}
                                setTitles={setTitles}
                                push={push}
                                replace={replace}
                                back={back}
                                cancel={cancel}
                                save={save}
                            />
                        ))}
                    </Chrome>
                ) : null}
            </div>
        </ViewStackContext.Provider>
    )
}

const MountedView = ({
    entry,
    isTop,
    saving,
    depth,
    readOnly,
    footerStart,
    setForms,
    setTitles,
    push,
    replace,
    back,
    cancel,
    save,
}: {
    entry: Entry
    isTop: boolean
    saving: boolean
    depth: 1 | 2
    readOnly: boolean
    footerStart: HTMLElement | null
    setForms: (update: (prev: Record<number, ViewForm>) => Record<number, ViewForm>) => void
    setTitles: (update: (prev: Record<number, string>) => Record<number, string>) => void
    push: <C>(
        parentKey: number,
        view: ViewDef<C>,
        params: C,
        target: ViewTarget,
    ) => Promise<boolean>
    replace: <C>(
        entryKey: number,
        view: ViewDef<C>,
        params: C,
        target: ViewTarget,
    ) => Promise<boolean>
    back: () => Promise<boolean>
    cancel: () => void
    save: () => Promise<void>
}) => {
    const {key} = entry
    const api = useMemo<ViewEntryApi>(
        () => ({
            setForm: (form) =>
                setForms((prev) => {
                    if (!form) {
                        if (!(key in prev)) return prev
                        const next = {...prev}
                        delete next[key]
                        return next
                    }
                    return {...prev, [key]: form}
                }),
            setTitle: (title) =>
                setTitles((prev) => (prev[key] === title ? prev : {...prev, [key]: title})),
        }),
        [key, setForms, setTitles],
    )
    const nav = useMemo<ViewNav>(
        () => ({
            depth,
            push: depth === 1 ? (view, params, target) => push(key, view, params, target) : null,
            replace: (view, params, target) => replace(key, view, params, target),
            back,
            cancel,
            save,
        }),
        [depth, key, push, replace, back, cancel, save],
    )
    const Component = entry.view.Component
    const ref = useRef<HTMLDivElement>(null)
    const openedOnTop = useRef(isTop)
    // A new view takes focus, so Escape works at once; a field that autofocused keeps it.
    useEffect(() => {
        const node = ref.current
        if (openedOnTop.current && node && !node.contains(document.activeElement)) {
            node.focus({preventScroll: true})
        }
    }, [])
    return (
        <div
            ref={ref}
            tabIndex={-1}
            data-testid={isTop ? "panel-view" : undefined}
            data-view-top={isTop ? "" : undefined}
            // Fades and slides in when it opens and when a child gives it back its place (MOTION-01).
            className="ag-view-enter flex min-h-0 min-w-0 flex-1 flex-col outline-none"
            style={isTop ? undefined : {display: "none"}}
            // While its Save runs the view takes no input: an edit made then would not be in the
            // request, and success closes the view.
            inert={isTop && saving}
            aria-busy={isTop && saving}
        >
            <ViewEntryContext.Provider value={api}>
                <ViewFooterStartContext.Provider value={footerStart}>
                    <Component
                        params={entry.params}
                        target={entry.target}
                        nav={nav}
                        readOnly={readOnly || undefined}
                    />
                </ViewFooterStartContext.Provider>
            </ViewEntryContext.Provider>
        </div>
    )
}
