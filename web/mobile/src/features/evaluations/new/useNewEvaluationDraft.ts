import {useMemo, useReducer} from "react"

import {
    createInitialDraft,
    newEvaluationReducer,
    type InitialDraftOptions,
    type NewEvaluationDraft,
    type NewEvaluationKind,
} from "./newEvaluationDraft"

/**
 * The wizard's draft. The sheet mounts the wizard only while open, so each open starts from an
 * empty draft with a new name suffix. `override` sets starting values for a story or a test.
 */
export const useNewEvaluationDraft = (
    kind: NewEvaluationKind,
    initial: InitialDraftOptions = {},
    override?: Partial<NewEvaluationDraft>,
) => {
    const [draft, dispatch] = useReducer(newEvaluationReducer, undefined, () => ({
        ...createInitialDraft(kind, initial),
        ...override,
    }))
    return useMemo(() => ({draft, dispatch}), [draft])
}
