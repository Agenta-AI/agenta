import {atom} from "jotai"

import {EnrichedEvaluationRun} from "../../usePreviewEvaluations/types"

// Collect all the running evaluation ids
export const runningEvaluationIdsAtom = atom<string[]>([])

// This atom collects the running evaluations a store it temporarily
// until we fix the issue on backend
export const tempEvaluationAtom = atom<EnrichedEvaluationRun[]>([])
