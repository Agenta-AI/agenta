import {atom} from "jotai"

import {evaluationRunStateAtom} from "./evaluationRunStateAtom"

// derived atoms for stable dependencies
export const evaluationRunIdAtom = atom((get) => get(evaluationRunStateAtom).enrichedRun?.id)
