import {atom} from "jotai"

import {Evaluator, EvaluatorConfig} from "../Types"

export const evaluatorsAtom = atom<Evaluator[]>([])

export const evaluatorConfigsAtom = atom<EvaluatorConfig[]>([])
