import type {TestsetSelectionMode} from "@agenta/playground-ui/components"
import {atom} from "jotai"

export const testsetSelectionModalModeAtom = atom<TestsetSelectionMode | null>(null)
export const testsetSyncCommitModalOpenAtom = atom(false)
