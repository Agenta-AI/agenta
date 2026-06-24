import {atom} from "jotai"

import type {EvalStepKind, EvalStepValueMap} from "./types"

export const evalStepValuesAtom = atom<Partial<EvalStepValueMap>>({})

export const activeEvalStepAtom = atom<EvalStepKind | null>(null)
