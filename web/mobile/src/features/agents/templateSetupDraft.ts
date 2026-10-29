import type {FileUIPart} from "ai"
import {atom} from "jotai"

/** Carry an edited Home prompt to the existing setup screen without putting it in the URL. */
export const templateSetupDraftAtom = atom<{
    base: string
    templateKey: string
    text?: string
    sessionId?: string
    parts?: FileUIPart[]
} | null>(null)
