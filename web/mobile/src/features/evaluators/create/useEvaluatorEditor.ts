import {useCallback, useEffect, useState} from "react"

import {useRevisionParam} from "../../revisions/useRevisionParam"

/**
 * Which automatic evaluator the editable drawer shows: a new one made from a template (a local
 * revision, kept in state), or a saved one (kept in `?revisionId=`, so a link opens it). After a
 * Create the address names the new evaluator, and the drawer stays open on it.
 */
export const useEvaluatorEditor = (enabled: boolean) => {
    const [revisionId, setRevisionId] = useRevisionParam()
    const [draftId, setDraftId] = useState<string | null>(null)
    // The local draft is held until the address names the evaluator it became, so the drawer
    // never closes in between and the connected app and test cases stay.
    useEffect(() => {
        if (draftId && revisionId) setDraftId(null)
    }, [draftId, revisionId])

    const editorId = enabled ? (revisionId ?? draftId) : null
    const close = useCallback(() => {
        setDraftId(null)
        setRevisionId(null)
    }, [setRevisionId])

    return {
        editorId,
        openDraft: setDraftId,
        show: setRevisionId,
        close,
    }
}
