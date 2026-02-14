import {useEffect, useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {playgroundController} from "@agenta/playground"
import {atom, useAtomValue} from "jotai"

export const useLocalDraftWarning = () => {
    const displayedEntityIds = useAtomValue(
        useMemo(() => playgroundController.selectors.displayedEntityIds(), []),
    )

    const hasUnsavedOrLocalDraftsAtom = useMemo(
        () =>
            atom((get) =>
                displayedEntityIds.some((entityId) => {
                    if (isLocalDraftId(entityId)) return true
                    return get(runnableBridge.isDirty(entityId))
                }),
            ),
        [displayedEntityIds],
    )

    const hasUnsavedOrLocalDrafts = useAtomValue(hasUnsavedOrLocalDraftsAtom)

    useEffect(() => {
        if (!hasUnsavedOrLocalDrafts) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            const message =
                "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?"
            e.preventDefault()
            e.returnValue = message
            return message
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)
        }
    }, [hasUnsavedOrLocalDrafts])
}
