import {atom} from "jotai"

import {Evaluator, SimpleEvaluator} from "../Types"

export const evaluatorsAtom = atom<Evaluator[]>([])

export const evaluatorConfigsAtom = atom<SimpleEvaluator[]>([])
