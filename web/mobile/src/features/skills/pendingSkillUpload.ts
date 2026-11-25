import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {atom} from "jotai"

/** An upload picked on the list, read by the create page it opens. */
export const pendingSkillUploadAtom = atom<Promise<SkillUploadScan> | null>(null)
