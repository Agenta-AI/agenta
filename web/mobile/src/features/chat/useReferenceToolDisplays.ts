import {useEffect, useMemo} from "react"

import {referenceToolSkin, registerChatSkin} from "@agenta/chat/skin"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/** Teach the tool-display registry the revision's own gateway tools, so their rows wear the app's logo. */
export const useReferenceToolDisplays = (revisionId: string | null) => {
    // The revision that runs, pinned or latest: a pinned one may carry other tools than the latest.
    const parameters = useAtomValue(
        useMemo(() => workflowMolecule.selectors.parameters(revisionId ?? ""), [revisionId]),
    )
    useEffect(() => {
        if (!parameters) return
        registerChatSkin(referenceToolSkin(parameters))
    }, [parameters])
}
