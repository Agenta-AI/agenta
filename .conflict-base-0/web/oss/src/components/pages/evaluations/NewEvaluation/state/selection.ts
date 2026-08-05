import {atom} from "jotai"

export const selectedTestsetIdAtom = atom<string>("")
export const selectedTestsetRevisionIdAtom = atom<string>("")
export const selectedTestsetNameAtom = atom<string>("")
export const selectedTestsetVersionAtom = atom<number | null>(null)
export const selectedEvalConfigsAtom = atom<string[]>([])
