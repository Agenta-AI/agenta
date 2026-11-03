import {useCallback, useEffect, useState} from "react"

import {useUnsavedGuard} from "../../automations/useUnsavedGuard"

import {LeavePrompt} from "./LeavePrompt"

/**
 * Stops a route change or a tab close while the test set has unsaved changes.
 *
 * The route change is stopped by `useUnsavedGuard`; this adds the tab close and the prompt. The
 * prompt offers three ways out. "Save" calls `onSave` (the commit step) and keeps the page, so
 * the changes are not lost (the old app also left the page). "Discard changes" calls
 * `onDiscard` and goes on.
 *
 * `leave(url)` goes to a page with no prompt, for the moves that are not a question: after a
 * commit or an archive there is nothing left to save. Render `prompt` once on the page.
 */
export function useTestsetLeaveGuard({
    dirty,
    isNew,
    onSave,
    onDiscard,
}: {
    dirty: boolean
    isNew: boolean
    onSave: () => void
    onDiscard: () => void
}) {
    // The way on, kept until the reader answers. It is a function, so it sits in state boxed.
    const [proceed, setProceed] = useState<{go: () => void} | null>(null)

    const askBeforeLeaving = useCallback(
        (request: {onOk: () => void | Promise<void>}) =>
            setProceed({go: () => void request.onOk()}),
        [],
    )
    // `LeavePrompt` asks its own question, so the guard's title and message are not shown here.
    const leave = useUnsavedGuard({
        dirty,
        confirm: askBeforeLeaving,
        title: "Unsaved changes",
        message: "You have unsaved changes in your test set.",
    })

    useEffect(() => {
        if (!dirty) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ""
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [dirty])

    const prompt = (
        <LeavePrompt
            open={proceed !== null}
            isNew={isNew}
            onCancel={() => setProceed(null)}
            onSave={() => {
                setProceed(null)
                onSave()
            }}
            onLeave={() => {
                const way = proceed
                setProceed(null)
                onDiscard()
                way?.go()
            }}
        />
    )

    return {leave, prompt}
}
