import {atomWithImmer} from "jotai-immer"

import {EvaluationRunState} from "../../types"
import {initialState} from "../constants"

// Cache atom instance on globalThis so its identity survives module reloads (HMR)
const ATOM_KEY = "__agenta_evaluationRunStateAtom__"

export const evaluationRunStateAtom =
    // @ts-expect-error – runtime augmentation of globalThis
    (globalThis[ATOM_KEY] as ReturnType<typeof atomWithImmer<EvaluationRunState>> | undefined) ??
    ((): ReturnType<typeof atomWithImmer<EvaluationRunState>> => {
        const atomInstance = atomWithImmer<EvaluationRunState>(initialState)
        // @ts-expect-error – runtime augmentation of globalThis
        globalThis[ATOM_KEY] = atomInstance
        return atomInstance
    })()
