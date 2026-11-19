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
    /** Unique per open, so a reopened view mounts fresh. */
    key: number
    /** Bumped to remount the view, which drops its local form (Discard before a child opens). */
    instance: number
    view: ViewDef<unknown>
    params: unknown
    target: ViewTarget
}

interface PendingQuestion {
    description: string
    canSave: boolean
    resolve: (answer: LeaveAnswer) => void
}

/** How a dirty form was settled before an action: nothing to settle, dropped, or saved. */
type Settled = "clean" | "discarded" | "saved"

const MENU_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

// Unique per open across hosts, so a reopened view mounts fresh. Never stored.
let lastEntryKey = 0
const newEntry = (view: ViewDef<unknown>, params: unknown, target: ViewTarget): Entry => ({
    key: ++lastEntryKey,
    instance: 0,
    view,
    params,
    target,
})

/**
 * Owns the view stack of one container (D2). `children` is the root: it stays mounted (hidden)
 * while a view is open, so it keeps its scroll position. Each open view stays mounted while a
 * child covers it, so a picker never drops its parent's form.
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
    const askingRef = useRef(false)
    const hostRef = useRef<HTMLDivElement>(null)

    /** Navigation waits for a save in flight to resolve. */
    const waitForSave = useCallback(async () => {
        while (savingRef.current) await savingRef.current
    }, [])

    /** One save at a time; a second call while one runs is ignored (resolves false). */
    const runSave = useCallback(async (entryKey: number): Promise<boolean> => {
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
        if (!ok) setFailedKey(entryKey)
        return ok
    }, [])

    const ask = useCallback(
        (form: ViewForm) =>
            new Promise<LeaveAnswer>((resolve) => {
                setQuestion({
                    description: form.leaveDescription,
                    canSave: form.valid,
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
     * kept editing or the save failed; the action must then not run.
     */
    const settle = useCallback(
        async (scope: Entry[]): Promise<Settled | false> => {
            const dirty = scope.find((entry) => formsRef.current[entry.key]?.dirty)
            if (!dirty) return "clean"
            if (askingRef.current) return false
            askingRef.current = true
            try {
                const answer = await ask(formsRef.current[dirty.key])
                if (answer === "keep") return false
                if (answer === "discard") return "discarded"
                return (await runSave(dirty.key)) ? "saved" : false
            } finally {
                askingRef.current = false
            }
        },
        [ask, runSave],
    )

    const dropForms = useCallback((keys: number[]) => {
        setForms((prev) => {
            const next = {...prev}
            for (const key of keys) delete next[key]
            return next
        })
    }, [])

    const setStack = useCallback(
        (next: Entry[]) => {
            const kept = new Set(next.map((entry) => entry.key))
            dropForms(entriesRef.current.filter((e) => !kept.has(e.key)).map((e) => e.key))
            entriesRef.current = next
            setEntries(next)
            setFailedKey(null)
        },
        [dropForms],
    )

    const open = useCallback(
        async <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
            await waitForSave()
            if (!(await settle(entriesRef.current))) return false
            setStack([newEntry(view as ViewDef<unknown>, params, target)])
            return true
        },
        [settle, setStack, waitForSave],
    )

    const closeAll = useCallback(async () => {
        await waitForSave()
        if (entriesRef.current.length === 0) return true
        if (!(await settle(entriesRef.current))) return false
        setStack([])
        return true
    }, [settle, setStack, waitForSave])

    /** Guarded back from the top view: only the top view's own form asks. */
    const back = useCallback(async () => {
        await waitForSave()
        const current = entriesRef.current
        if (current.length === 0) return true
        if (!(await settle(current.slice(-1)))) return false
        setStack(current.slice(0, -1))
        return true
    }, [settle, setStack, waitForSave])

    const cancel = useCallback(() => {
        if (savingRef.current) return
        setStack(entriesRef.current.slice(0, -1))
    }, [setStack])

    const push = useCallback(
        async <C,>(parentKey: number, view: ViewDef<C>, params: C, target: ViewTarget) => {
            await waitForSave()
            const current = entriesRef.current
            if (current.length !== 1 || current[0].key !== parentKey) return false
            let parent = current[0]
            // One editable form at a time: a child with its own form needs a clean parent. A
            // picker ("immediate") opens over the dirty parent, which keeps its edits.
            if (view.apply === "on_save") {
                const settled = await settle([parent])
                if (!settled) return false
                if (settled === "discarded") {
                    dropForms([parent.key])
                    parent = {...parent, instance: parent.instance + 1}
                }
            }
            setStack([parent, newEntry(view as ViewDef<unknown>, params, target)])
            return true
        },
        [dropForms, settle, setStack, waitForSave],
    )

    const save = useCallback(async () => {
        const top = entriesRef.current.at(-1)
        if (!top) return
        if (await runSave(top.key)) {
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
                                key={`${entry.key}:${entry.instance}`}
                                entry={entry}
                                isTop={entry === top}
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
                onAnswer={(answer) => question?.resolve(answer)}
            />
        </ViewStackContext.Provider>
    )
}

const MountedView = ({
    entry,
    isTop,
    depth,
    setForms,
    setTitles,
    push,
    back,
    cancel,
}: {
    entry: Entry
    isTop: boolean
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
        >
            <ViewEntryContext.Provider value={api}>
                <Component params={entry.params} target={entry.target} nav={nav} />
            </ViewEntryContext.Provider>
        </div>
    )
}
