import {atom} from "jotai"

import type {TraceData} from "../../../useEvaluationRunScenarioSteps/types"

// traceId -> TraceData
export const traceCacheAtom = atom(new Map<string, TraceData>())
