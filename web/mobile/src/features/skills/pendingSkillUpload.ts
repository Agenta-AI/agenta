import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {atom} from "jotai"

/** An upload picked on the list, read by the create page it opens; boxed so jotai does not await it. */
export const pendingSkillUploadAtom = atom<{scan: Promise<SkillUploadScan>} | null>(null)
