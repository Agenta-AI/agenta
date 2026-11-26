import {useCallback, useState} from "react"

import type {Filter} from "@agenta/observability"

export interface LiveEvaluationDraft {
    name: string
    description: string
    /** The user's trace filter rows. The locked invocation row is not stored. */
    userFilters: Filter[]
    /** Percent between 0 and 100, or null for no sampling. */
    samplingRate: number | null
    evaluatorRevisionId: string | null
}

const EMPTY_DRAFT: LiveEvaluationDraft = {
    name: "",
    description: "",
    userFilters: [],
    samplingRate: 100,
    evaluatorRevisionId: null,
}

/** Four base-36 characters, for the name the form suggests from the evaluator. */
const nameSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, "0")

/**
 * The live evaluation form. Field errors show after the first submit, so an untouched field
 * does not start red.
 */
export const useLiveEvaluationForm = (initial?: Partial<LiveEvaluationDraft>) => {
    const [draft, setDraft] = useState<LiveEvaluationDraft>(() => ({...EMPTY_DRAFT, ...initial}))
    const [showErrors, setShowErrors] = useState(false)

    const update = useCallback(
        (patch: Partial<LiveEvaluationDraft>) => setDraft((prev) => ({...prev, ...patch})),
        [],
    )

    /** Pick an evaluator. An empty name becomes `{evaluator}-{suffix}`; a typed name stays. */
    const pickEvaluator = useCallback((revisionId: string, evaluatorName: string) => {
        setDraft((prev) => ({
            ...prev,
            evaluatorRevisionId: revisionId,
            name: prev.name.trim() ? prev.name : `${evaluatorName}-${nameSuffix()}`,
        }))
    }, [])

    const problems = {
        name: draft.name.trim() ? null : "Enter a name",
        evaluator: draft.evaluatorRevisionId ? null : "Select an evaluator",
    }

    /** Shows the field errors and says whether the draft can be sent. */
    const validate = () => {
        setShowErrors(true)
        return problems.name === null && problems.evaluator === null
    }

    return {
        draft,
        update,
        pickEvaluator,
        validate,
        errors: showErrors ? problems : {name: null, evaluator: null},
    }
}
