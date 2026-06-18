import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {EvalStepKind, EvalStepSlot, EvalStepValueMap} from "./types"

export const evalStepValuesAtom = atom<Partial<EvalStepValueMap>>({})

export const evalStepValueAtomFamily = atomFamily((kind: EvalStepKind) =>
    atom(
        (get) => get(evalStepValuesAtom)[kind],
        (get, set, value: EvalStepValueMap[typeof kind]) => {
            set(evalStepValuesAtom, {...get(evalStepValuesAtom), [kind]: value})
        },
    ),
)

export const activeEvalStepAtom = atom<EvalStepKind | null>(null)
export const evalStepsConfigAtom = atom<EvalStepSlot[]>([])
