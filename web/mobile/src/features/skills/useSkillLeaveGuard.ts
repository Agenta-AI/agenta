import {useCallback, useEffect} from "react"

import {useUnsavedGuard} from "../automations/useUnsavedGuard"
import {useConfirmModal} from "../settings/useConfirmModal"

/** Asks before leaving a skill with unsaved changes; `leave(url)` goes without asking. */
export const useSkillLeaveGuard = (dirty: boolean) => {
    const {confirm, modal} = useConfirmModal()
    const ask = useCallback(
        (request: {title: string; message: string; onOk: () => void | Promise<void>}) =>
            confirm({...request, okText: "Discard", danger: true}),
        [confirm],
    )
    const leave = useUnsavedGuard({
        dirty,
        confirm: ask,
        title: "Discard unsaved changes?",
        message: "This skill has changes that are not saved. They will be lost.",
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

    return {leave, modal}
}
