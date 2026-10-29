import {atom} from "jotai"

/** Open state of the what's-new dialog; Home and the help menu's release rows both set it. */
export const whatsNewAtom = atom<{releaseId?: string} | null>(null)
