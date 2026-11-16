import {atomWithStorage} from "jotai/utils"

export const TEMPLATES_HIDDEN_KEY = "agenta:templates:strip-hidden"

export const templatesHiddenAtom = atomWithStorage<boolean>(TEMPLATES_HIDDEN_KEY, false)
