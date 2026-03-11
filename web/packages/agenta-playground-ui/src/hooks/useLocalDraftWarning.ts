import {useEffect, useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {playgroundController} from "@agenta/playground"
import {atom, useAtomValue} from "jotai"

export const useLocalDraftWarning = () => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))

    const hasUnsavedOrLocalDraftsAtom = useMemo(
        () =>
            atom((get) =>
                nodes
                    .filter((n) => n.depth === 0)
                    .some((node) => {
                        if (isLocalDraftId(node.entityId)) return true
                        const scoped = runnableBridge.forType(node.entityType)
                        return get(scoped.isDirty(node.entityId))
                    }),
            ),
        [nodes],
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
