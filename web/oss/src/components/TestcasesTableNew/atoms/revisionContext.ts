import {atom} from "jotai"

/**
 * Current revision ID from URL - single source of truth
 * This is in a separate file to avoid circular imports
 */
export const testcasesRevisionIdAtom = atom<string | null>(null)
