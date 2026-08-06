import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/** Search term for filtering registry revisions by variant name */
export const registrySearchTermAtom = atom("")

/** Display mode: flat (all revisions) or grouped (by variant) */
export const registryDisplayModeAtom = atomWithStorage<"flat" | "grouped">(
    "agenta:registry:display-mode",
    "flat",
)
