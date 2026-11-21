import {useEffect, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {createT} from "@agenta/i18n"
import panelsCatalog from "@agenta/i18n/catalogs/playground.panels"
import {playgroundController} from "@agenta/playground"
import {atom, useAtomValue} from "jotai"

/**
 * Asks the browser to confirm before the page unloads while a revision on the playground is a
 * local draft or has unsaved edits. Returns that flag, so a host can guard in-app navigation as well.
 */
export const useLocalDraftWarning = (): boolean => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))

    const hasUnsavedOrLocalDraftsAtom = useMemo(
        () =>
            // Every node, not only the first ones: the evaluator playground edits an evaluator
            // that runs after an app.
            atom((get) =>
                nodes.some((node) => {
                    if (isLocalDraftId(node.entityId)) return true
                    return get(workflowMolecule.selectors.isDirty(node.entityId))
                }),
            ),
        [nodes],
    )

    const hasUnsavedOrLocalDrafts = useAtomValue(hasUnsavedOrLocalDraftsAtom)

    useEffect(() => {
        if (!hasUnsavedOrLocalDrafts) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            const message = createT(panelsCatalog)("playground.panels.leaveWarning")
            e.preventDefault()
            e.returnValue = message
            return message
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)
        }
    }, [hasUnsavedOrLocalDrafts])

    return hasUnsavedOrLocalDrafts
}
