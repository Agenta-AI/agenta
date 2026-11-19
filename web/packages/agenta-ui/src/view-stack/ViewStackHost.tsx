import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type ComponentType,
    type KeyboardEvent,
    type ReactNode,
} from "react"

import {ViewEntryContext, ViewStackContext, type ViewEntryApi} from "./context"
import type {ViewChromeProps, ViewDef, ViewForm, ViewNav, ViewStack, ViewTarget} from "./types"
import {UnsavedChangesDialog, type LeaveAnswer} from "./UnsavedChangesDialog"

interface Entry {
    /** Unique per open; a new key remounts the view, which drops its local form. */
    key: number
    view: ViewDef<unknown>
    params: unknown
    target: ViewTarget
}

interface PendingQuestion {
    description: string
    canSave: boolean
    saveFailed: boolean
    resolve: (answer: LeaveAnswer) => void
}

/** How a dirty form was settled before an action: nothing to settle, dropped, or saved. */
type Settled = "clean" | "discarded" | "saved"

const MENU_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

// Unique per open across hosts, so a reopened view mounts fresh. Never stored.
let lastEntryKey = 0
const newEntry = (view: ViewDef<unknown>, params: unknown, target: ViewTarget): Entry => ({
    key: ++lastEntryKey,
    view,
    params,
    target,
})
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
    children,
}: {
    chrome: ComponentType<ViewChromeProps>
    /** The first crumb (for example the tab name). Without it the breadcrumb starts at the first view. */
    rootTitle?: string
    /** Escape with an empty stack: the panel closes itself; a page passes nothing. */
    onEscapeAtRoot?: () => void
    children: ReactNode
}) => {
    const [entries, setEntries] = useState<Entry[]>([])
    const [forms, setForms] = useState<Record<number, ViewForm>>({})
    const [titles, setTitles] = useState<Record<number, string>>({})
    const [saving, setSaving] = useState(false)
    const [failedKey, setFailedKey] = useState<number | null>(null)
    const [question, setQuestion] = useState<PendingQuestion | null>(null)

    // Refs mirror the state for the async actions, which must read the latest values.
    const entriesRef = useRef(entries)
    entriesRef.current = entries
    const formsRef = useRef(forms)
    formsRef.current = forms
    const savingRef = useRef<Promise<boolean> | null>(null)
    // One guarded navigation at a time, from its first wait to its stack update.
    const navigatingRef = useRef(false)
    const hostRef = useRef<HTMLDivElement>(null)

    /** Navigation waits for a save in flight to resolve. */
    const waitForSave = useCallback(async () => {
        while (savingRef.current) await savingRef.current
    }, [])

    /**
     * One save at a time; a second call while one runs is ignored (resolves false). A failure
     * from the Save button marks the view; the dialog shows its own failures.
     */
    const runSave = useCallback(
        async (entryKey: number, markFailure: boolean): Promise<boolean> => {
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
            const ok = await run
            savingRef.current = null
            setSaving(false)
            if (!ok && markFailure) setFailedKey(entryKey)
            return ok
        },
        [],
    )

    const ask = useCallback(
        (form: ViewForm, saveFailed: boolean) =>
            new Promise<LeaveAnswer>((resolve) => {
                setQuestion({
                    description: form.leaveDescription,
                    canSave: form.valid,
                    saveFailed,
                    resolve: (answer) => {
                        setQuestion(null)
                        resolve(answer)
                    },
                })
            }),
        [],
    )

    /**
     * Settle the one dirty form among `scope` before an action. Resolves false when the person
     * kept editing; the action must then not run. A failed "Save changes" asks again with the
     * error, so the failure shows even when the dirty form sits under a picker.
     */
    const settle = useCallback(
        async (scope: Entry[]): Promise<Settled | false> => {
            const dirty = scope.find((entry) => formsRef.current[entry.key]?.dirty)
            if (!dirty) return "clean"
            let saveFailed = false
            for (;;) {
                const form = formsRef.current[dirty.key]
                // The view left while the dialog was open: nothing is left to settle.
                if (!form) return "clean"
                const answer = await ask(form, saveFailed)
                if (answer === "keep") return false
                if (answer === "discard") return "discarded"
                if (await runSave(dirty.key, false)) return "saved"
                saveFailed = true
            }
        },
        [ask, runSave],
    )

    /** Replace the stack. Forms and titles of views that leave go with them. */
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
        entriesRef.current = next
        setEntries(next)
        setFailedKey(null)
    }, [])

    /**
     * Runs one guarded navigation. Another one asked for meanwhile (a second click while the
     * dialog asks or a save runs) is dropped and resolves false.
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
            }
        },
        [waitForSave],
    )

    const open = useCallback(
        <P,>(view: ViewDef<P>, params: P, target: ViewTarget) =>
            exclusive(async () => {
                if (!(await settle(entriesRef.current))) return false
                setStack([newEntry(view as ViewDef<unknown>, params, target)])
                return true
            }),
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
        if (savingRef.current || navigatingRef.current) return
        setStack(entriesRef.current.slice(0, -1))
    }, [setStack])

    const push = useCallback(
        <C,>(parentKey: number, view: ViewDef<C>, params: C, target: ViewTarget) =>
            exclusive(async () => {
                const current = entriesRef.current
                if (current.length !== 1 || current[0].key !== parentKey) return false
                let parent = current[0]
                // One editable form at a time: a child with its own form needs a clean parent.
                // A picker ("immediate") opens over the dirty parent, which keeps its edits.
                // After Save or Discard the parent mounts again, so no stale dirty form stays
                // under the child.
                if (view.apply === "on_save") {
                    const settled = await settle([parent])
                    if (!settled) return false
                    if (settled !== "clean") parent = remount(parent)
                }
                setStack([parent, newEntry(view as ViewDef<unknown>, params, target)])
                return true
            }),
        [exclusive, settle, setStack],
    )

    const save = useCallback(async () => {
        const top = entriesRef.current.at(-1)
        if (!top || navigatingRef.current) return
        if (await runSave(top.key, true)) {
            setStack(entriesRef.current.filter((entry) => entry.key !== top.key))
        }
    }, [runSave, setStack])

    const dirty = saving || Object.values(forms).some((form) => form.dirty)
    const depth = entries.length as 0 | 1 | 2

    const stack = useMemo<ViewStack>(
        () => ({open, closeAll, dirty, depth}),
        [open, closeAll, dirty, depth],
    )

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return
        // An open menu, popover or dialog inside the views closes first; it handles its own
        // Escape. A dialog or drawer that holds the whole host does not count.
        const layer = (event.target as HTMLElement | null)?.closest?.(MENU_SELECTOR)
        if (layer && !(hostRef.current && layer.contains(hostRef.current))) return
        if (entriesRef.current.length > 0) {
            event.preventDefault()
            void back()
            return
        }
        if (onEscapeAtRoot) {
            event.preventDefault()
            onEscapeAtRoot()
        }
    }

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
                <div style={{display: top ? "none" : "contents"}}>{children}</div>
                {top ? (
                    <Chrome
                        crumbs={crumbs}
                        apply={top.view.apply}
                        wide={Boolean(top.view.wide)}
                        form={
                            topForm ? {...topForm, saving, saveFailed: failedKey === top.key} : null
                        }
                        onBack={() => void back()}
                        onCancel={cancel}
                        onSave={() => void save()}
                    >
                        {entries.map((entry, index) => (
                            <MountedView
                                key={entry.key}
                                entry={entry}
                                isTop={entry === top}
                                saving={saving}
                                depth={(index + 1) as 1 | 2}
                                setForms={setForms}
                                setTitles={setTitles}
                                push={push}
                                back={back}
                                cancel={cancel}
                            />
                        ))}
                    </Chrome>
                ) : null}
            </div>
            <UnsavedChangesDialog
                open={question !== null}
                description={question?.description ?? ""}
                canSave={question?.canSave ?? false}
                saveFailed={question?.saveFailed ?? false}
                onAnswer={(answer) => question?.resolve(answer)}
            />
        </ViewStackContext.Provider>
    )
}

const MountedView = ({
    entry,
    isTop,
    saving,
    depth,
    setForms,
    setTitles,
    push,
    back,
    cancel,
}: {
    entry: Entry
    isTop: boolean
    saving: boolean
    depth: 1 | 2
    setForms: (update: (prev: Record<number, ViewForm>) => Record<number, ViewForm>) => void
    setTitles: (update: (prev: Record<number, string>) => Record<number, string>) => void
    push: <C>(
        parentKey: number,
        view: ViewDef<C>,
        params: C,
        target: ViewTarget,
    ) => Promise<boolean>
    back: () => Promise<boolean>
    cancel: () => void
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
            back,
            cancel,
        }),
        [depth, key, push, back, cancel],
    )
    const Component = entry.view.Component
    return (
        <div
            data-testid={isTop ? "panel-view" : undefined}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            style={isTop ? undefined : {display: "none"}}
            // While its Save runs the view takes no input: an edit made then would not be in the
            // request, and success closes the view.
            inert={isTop && saving}
            aria-busy={isTop && saving}
        >
            <ViewEntryContext.Provider value={api}>
                <Component params={entry.params} target={entry.target} nav={nav} />
            </ViewEntryContext.Provider>
        </div>
    )
}
