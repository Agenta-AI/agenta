import {atom} from "jotai"

export type PreviewEvaluationType = "auto" | "human" | null

export const previewEvalTypeAtom = atom<PreviewEvaluationType>(null)
