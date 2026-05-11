import {atom} from "jotai"

/** Search term for filtering deployment revisions */
export const deploymentSearchTermAtom = atom("")

/** Currently selected environment ID (set when user clicks an environment card) */
export const selectedEnvironmentIdAtom = atom<string | null>(null)

/** Deployment note for publish operations (used by confirmation modal) */
export const deploymentNoteAtom = atom("")
