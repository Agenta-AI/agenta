import {tracesAtom} from "@agenta/observability"
import {atom} from "jotai"

/**
 * Boolean-only view of the loaded rows. The toolbar only needs "are there any", so reading this
 * instead of `tracesAtom` keeps the buttons from re-rendering on every page append.
 */
export const hasTracesAtom = atom((get) => get(tracesAtom).length > 0)
