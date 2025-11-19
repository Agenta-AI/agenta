import {atomWithStorage} from "jotai/utils"

export const lastVisitedEvaluationAtom = atomWithStorage<string>(
    "evaluations-last-visited",
    "auto_evaluation",
)
