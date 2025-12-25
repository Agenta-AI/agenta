import {produce, enablePatches, applyPatches, Patch} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {BaseEntity} from "./types"

enablePatches()

/**
 * Draft state with undo/redo capability using Immer patches
 */
interface DraftState<T extends BaseEntity> {
    current: T
    original: T
    history: {
        patches: Patch[]
        inversePatches: Patch[]
        timestamp: number
    }[]
    historyIndex: number
    isDirty: boolean
}

/**
 * Configuration for draft store
 */
interface DraftStoreConfig<_T extends BaseEntity = BaseEntity> {
    /** Maximum history size */
    maxHistorySize?: number
}

/**
 * Creates a draft management system with undo/redo support
 * More memory-efficient than atomWithHistory because it uses Immer patches
 *
 * @example
 * ```ts
 * const testcaseDraftStore = createDraftStore<Testcase>()
 *
 * // Initialize draft from entity
 * set(testcaseDraftStore.initDraft, { id: 'tc-1', entity: testcase })
 *
 * // Make changes
 * set(testcaseDraftStore.updateDraft('tc-1'), (draft) => {
 *   draft.name = 'New name'
 *   draft.description = 'New description'
 * })
 *
 * // Undo
 * set(testcaseDraftStore.undo, 'tc-1')
 *
 * // Redo
 * set(testcaseDraftStore.redo, 'tc-1')
 *
 * // Check if can undo/redo
 * const canUndo = get(testcaseDraftStore.canUndo('tc-1'))
 * ```
 */
export function createDraftStore<T extends BaseEntity>(config?: DraftStoreConfig<T>) {
    const {maxHistorySize = 50} = config ?? {}

    // Storage for all drafts
    const draftsAtom = atom<Record<string, DraftState<T>>>({})

    // Initialize a draft from an entity
    const initDraftAtom = atom(null, (get, set, {id, entity}: {id: string; entity: T}) => {
        set(draftsAtom, (prev) => ({
            ...prev,
            [id]: {
                current: entity,
                original: entity,
                history: [],
                historyIndex: -1,
                isDirty: false,
            },
        }))
    })

    // Update draft with Immer producer
    const updateDraftAtomFamily = atomFamily((id: string) =>
        atom(null, (get, set, producer: (draft: T) => void) => {
            const drafts = get(draftsAtom)
            const existing = drafts[id]

            if (!existing) {
                return
            }

            let patches: Patch[] = []
            let inversePatches: Patch[] = []

            const nextCurrent = produce(
                existing.current,
                (draft) => {
                    producer(draft as T)
                },
                (p, ip) => {
                    patches = p
                    inversePatches = ip
                },
            ) as T

            // Only record if there were actual changes
            if (patches.length === 0) return

            // Truncate history if we're not at the end
            const truncatedHistory = existing.history.slice(0, existing.historyIndex + 1)

            // Add new history entry
            const newHistory = [
                ...truncatedHistory,
                {
                    patches,
                    inversePatches,
                    timestamp: Date.now(),
                },
            ]

            // Enforce max history size
            const trimmedHistory =
                newHistory.length > maxHistorySize
                    ? newHistory.slice(newHistory.length - maxHistorySize)
                    : newHistory

            set(draftsAtom, (prev) => ({
                ...prev,
                [id]: {
                    current: nextCurrent,
                    original: existing.original,
                    history: trimmedHistory,
                    historyIndex: trimmedHistory.length - 1,
                    isDirty: true,
                },
            }))
        }),
    )

    // Undo
    const undoAtom = atom(null, (get, set, id: string) => {
        const drafts = get(draftsAtom)
        const draft = drafts[id]

        if (!draft || draft.historyIndex < 0) {
            return
        }

        const {inversePatches} = draft.history[draft.historyIndex]
        const prevCurrent = applyPatches(draft.current, inversePatches) as T

        set(draftsAtom, (prev) => ({
            ...prev,
            [id]: {
                ...draft,
                current: prevCurrent,
                historyIndex: draft.historyIndex - 1,
                isDirty: draft.historyIndex > 0,
            },
        }))
    })

    // Redo
    const redoAtom = atom(null, (get, set, id: string) => {
        const drafts = get(draftsAtom)
        const draft = drafts[id]

        if (!draft || draft.historyIndex >= draft.history.length - 1) return

        const nextIndex = draft.historyIndex + 1
        const {patches} = draft.history[nextIndex]
        const nextCurrent = applyPatches(draft.current, patches) as T

        set(draftsAtom, (prev) => ({
            ...prev,
            [id]: {
                ...draft,
                current: nextCurrent,
                historyIndex: nextIndex,
                isDirty: true,
            },
        }))
    })

    // Can undo
    const canUndoAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const draft = get(draftsAtom)[id]
            return draft ? draft.historyIndex >= 0 : false
        }),
    )

    // Can redo
    const canRedoAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const draft = get(draftsAtom)[id]
            return draft ? draft.historyIndex < draft.history.length - 1 : false
        }),
    )

    // Get current draft
    const draftAtomFamily = atomFamily((id: string) =>
        atom(
            (get) => {
                const draft = get(draftsAtom)[id]
                return draft?.current ?? null
            },
            (get, set, update: T | ((prev: T | null) => T | null)) => {
                const prev = get(draftsAtom)[id]?.current ?? null
                const next = typeof update === "function" ? update(prev) : update

                if (!next) {
                    set(draftsAtom, (prev) => {
                        const nextDrafts = {...prev}
                        delete nextDrafts[id]
                        return nextDrafts
                    })
                    return
                }

                set(initDraftAtom, {id, entity: next})
            },
        ),
    )

    // Check if draft is dirty
    const isDirtyAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const draft = get(draftsAtom)[id]
            return draft?.isDirty ?? false
        }),
    )

    // Get original (for restoring on discard)
    const originalAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const draft = get(draftsAtom)[id]
            return draft?.original ?? null
        }),
    )

    // Discard draft
    const discardDraftAtom = atom(null, (get, set, id: string) => {
        set(draftsAtom, (prev) => {
            const next = {...prev}
            delete next[id]
            return next
        })
    })

    // Commit draft (clears history, marks as clean)
    const commitDraftAtom = atom(null, (get, set, id: string) => {
        const drafts = get(draftsAtom)
        const draft = drafts[id]

        if (!draft) return

        set(draftsAtom, (prev) => ({
            ...prev,
            [id]: {
                current: draft.current,
                original: draft.current,
                history: [],
                historyIndex: -1,
                isDirty: false,
            },
        }))
    })

    // Clear all drafts
    const clearAllDraftsAtom = atom(null, (_get, set) => {
        set(draftsAtom, {})
    })

    return {
        // Core atom
        draftsAtom,

        // Initialization
        initDraft: initDraftAtom,

        // Mutations
        updateDraft: updateDraftAtomFamily,
        undo: undoAtom,
        redo: redoAtom,

        // Queries
        draft: draftAtomFamily,
        original: originalAtomFamily,
        canUndo: canUndoAtomFamily,
        canRedo: canRedoAtomFamily,
        isDirty: isDirtyAtomFamily,

        // Lifecycle
        discardDraft: discardDraftAtom,
        commitDraft: commitDraftAtom,
        clearAllDrafts: clearAllDraftsAtom,
    }
}
