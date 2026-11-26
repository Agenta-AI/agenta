import {useEffect, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {createT} from "@agenta/i18n"
import panelsCatalog from "@agenta/i18n/catalogs/playground.panels"
import {playgroundController} from "@agenta/playground"
import {atom, useAtomValue} from "jotai"

/** Confirms page unload while a playground revision has unsaved edits; returns that flag. */
export const useLocalDraftWarning = (): boolean => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))

    const hasUnsavedOrLocalDraftsAtom = useMemo(
        () =>
            // Every node, not only the first ones: the evaluator playground edits an evaluator
            // that runs after an app.
            atom((get) =>
                // A local copy is dirty against its source revision, so an untouched copy is not.
                nodes.some((node) => get(workflowMolecule.selectors.isDirty(node.entityId))),
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
