import {atom} from "jotai"
import {Evaluation, EvaluationScenario, Evaluator, EvaluatorConfig} from "../Types"

export const evaluationAtom = atom<Evaluation | undefined>(undefined)

export const evaluationScenariosAtom = atom<EvaluationScenario[]>([])

export const evaluatorsAtom = atom<Evaluator[]>([])

export const evaluatorConfigsAtom = atom<EvaluatorConfig[]>([])
