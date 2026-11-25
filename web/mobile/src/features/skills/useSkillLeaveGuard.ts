import {useCallback, useEffect} from "react"

import {useT} from "@agenta/i18n"
import skillsPageCatalog from "@agenta/i18n/catalogs/skills.page"

import {useUnsavedGuard} from "../automations/useUnsavedGuard"
import {useConfirmModal} from "../settings/useConfirmModal"

/** Asks before leaving a skill with unsaved changes; `leave(url)` goes without asking. */
export const useSkillLeaveGuard = (dirty: boolean, message: string) => {
    const t = useT(skillsPageCatalog)
    const {confirm, modal} = useConfirmModal()
    const title = t("skills.page.discardTitle")
    const okText = t("skills.page.discard")
    const cancelText = t("skills.page.keepEditing")
    const ask = useCallback(
        (request: {title: string; message: string; onOk: () => void | Promise<void>}) =>
            confirm({...request, okText, cancelText, danger: true}),
        [cancelText, confirm, okText],
    )
    const leave = useUnsavedGuard({dirty, confirm: ask, title, message})
    /** For a step inside the page, which no route change guards. */
    const discardThen = useCallback(
        (go: () => void) => (dirty ? ask({title, message, onOk: go}) : go()),
        [ask, dirty, message, title],
    )

    useEffect(() => {
        if (!dirty) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ""
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [dirty])

    return {leave, modal, discardThen}
}
