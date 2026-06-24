import {atom} from "jotai"

import type {EvalStepKind, EvalStepValueMap} from "./types"

export const evalStepValuesAtom = atom<Partial<EvalStepValueMap>>({})

export const activeEvalStepAtom = atom<EvalStepKind | null>(null)

/**
 * The evaluation name, mirrored into an atom so step sections (e.g. the traces
 * source alert) can react to edits in the always-visible name input. The submit
 * path still reads it through `context.getEvaluationName()`.
 */
export const evaluationNameAtom = atom<string>("")
