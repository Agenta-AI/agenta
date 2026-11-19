import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {atom} from "jotai"

/** An upload started on the list's empty state, handed to the create page to finish. */
export const pendingSkillUploadAtom = atom<Promise<SkillUploadScan> | null>(null)
