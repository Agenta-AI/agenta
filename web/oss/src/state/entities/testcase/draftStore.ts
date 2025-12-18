import {createDraftStore} from "../core/createDraftStore"

import type {FlattenedTestcase} from "./schema"

/**
 * Draft store for testcase editing
 * Provides undo/redo capability and discard functionality
 *
 * @example
 * ```tsx
 * // Initialize draft when opening drawer
 * const setInitDraft = useSetAtom(testcaseDraftStore.initDraft)
 * setInitDraft({ id: testcaseId, entity: testcase })
 *
 * // Read draft data
 * const draft = useAtomValue(testcaseDraftStore.draft(testcaseId))
 *
 * // Update draft
 * const updateDraft = useSetAtom(testcaseDraftStore.updateDraft(testcaseId))
 * updateDraft((draft) => { draft.fieldName = 'new value' })
 *
 * // Undo/Redo
 * const undo = useSetAtom(testcaseDraftStore.undo)
 * const redo = useSetAtom(testcaseDraftStore.redo)
 * undo(testcaseId)
 * redo(testcaseId)
 *
 * // Check if can undo/redo
 * const canUndo = useAtomValue(testcaseDraftStore.canUndo(testcaseId))
 * const canRedo = useAtomValue(testcaseDraftStore.canRedo(testcaseId))
 *
 * // Check if dirty
 * const isDirty = useAtomValue(testcaseDraftStore.isDirty(testcaseId))
 *
 * // Discard changes (revert to original)
 * const discardDraft = useSetAtom(testcaseDraftStore.discardDraft)
 * discardDraft(testcaseId)
 *
 * // Commit changes (make current the new original)
 * const commitDraft = useSetAtom(testcaseDraftStore.commitDraft)
 * commitDraft(testcaseId)
 * ```
 */
export const testcaseDraftStore = createDraftStore<FlattenedTestcase>({
    maxHistorySize: 50,
})

export default testcaseDraftStore
