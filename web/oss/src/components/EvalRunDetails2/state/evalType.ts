import {atom} from "jotai"

export type PreviewEvaluationType = "auto" | "human" | "online" | null

export const previewEvalTypeAtom = atom<PreviewEvaluationType>(null)
