import {atom} from "jotai"

/**
 * True while an open view form on this screen has edits (the view stack is dirty). The panel host
 * writes it from its view stack. While it is true, the session does not move to a newer saved
 * version: the header offers "Update to vN" instead, so the form keeps the version it edits
 * (design D7).
 */
export const viewFormDirtyAtom = atom(false)
