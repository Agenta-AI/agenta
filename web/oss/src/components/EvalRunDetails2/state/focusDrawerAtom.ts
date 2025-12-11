import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {compareRunIdsAtom} from "../atoms/compare"
import {evaluationPreviewTableStore} from "../evaluationPreviewTableStore"
import type {PreviewTableRow} from "../atoms/tableRows"

export interface FocusTarget {
    focusRunId: string | null
    focusScenarioId: string | null
    compareMode?: boolean
    testcaseId?: string | null
    scenarioIndex?: number | null
}

export interface FocusDrawerState extends FocusTarget {
    open: boolean
    isClosing: boolean
}

const initialFocusDrawerState: FocusDrawerState = {
    open: false,
    isClosing: false,
    focusRunId: null,
    focusScenarioId: null,
}

export const focusDrawerAtom = atomWithImmer<FocusDrawerState>(initialFocusDrawerState)

export const focusScenarioAtom = atom<FocusTarget | null>((get) => {
    const state = get(focusDrawerAtom) as FocusDrawerState
    const {focusRunId, focusScenarioId, compareMode, testcaseId, scenarioIndex} = state
    if (!focusScenarioId) return null
    return {focusRunId, focusScenarioId, compareMode, testcaseId, scenarioIndex}
})

export const isFocusDrawerOpenAtom = atom((get) => (get(focusDrawerAtom) as FocusDrawerState).open)

export const focusDrawerTargetAtom = atom<FocusTarget>((get) => {
    const state = get(focusDrawerAtom) as FocusDrawerState
    const {focusRunId, focusScenarioId, compareMode, testcaseId, scenarioIndex} = state
    return {focusRunId, focusScenarioId, compareMode, testcaseId, scenarioIndex}
})

export const setFocusDrawerTargetAtom = atom(null, (_get, set, target: FocusTarget) => {
    set(focusDrawerAtom, (draft: FocusDrawerState) => {
        if (
            draft.focusRunId === target.focusRunId &&
            draft.focusScenarioId === target.focusScenarioId &&
            draft.compareMode === target.compareMode &&
            draft.testcaseId === target.testcaseId &&
            draft.scenarioIndex === target.scenarioIndex
        ) {
            return
        }
        draft.focusRunId = target.focusRunId
        draft.focusScenarioId = target.focusScenarioId
        draft.compareMode = target.compareMode
        draft.testcaseId = target.testcaseId
        draft.scenarioIndex = target.scenarioIndex
    })
})

export const openFocusDrawerAtom = atom(null, (_get, set, target: FocusTarget) => {
    set(focusDrawerAtom, (draft: FocusDrawerState) => {
        const sameTarget =
            draft.focusRunId === target.focusRunId &&
            draft.focusScenarioId === target.focusScenarioId &&
            draft.compareMode === target.compareMode &&
            draft.testcaseId === target.testcaseId &&
            draft.scenarioIndex === target.scenarioIndex &&
            draft.open
        draft.open = true
        draft.isClosing = false
        if (!sameTarget) {
            draft.focusRunId = target.focusRunId
            draft.focusScenarioId = target.focusScenarioId
            draft.compareMode = target.compareMode
            draft.testcaseId = target.testcaseId
            draft.scenarioIndex = target.scenarioIndex
        }
    })
})

export const closeFocusDrawerAtom = atom(null, (_get, set) => {
    set(focusDrawerAtom, (draft: FocusDrawerState) => {
        if (!draft.open && !draft.focusScenarioId && !draft.focusRunId) {
            return
        }
        draft.open = false
        draft.isClosing = true
    })
})

export const resetFocusDrawerAtom = atom(null, (_get, set) => {
    set(focusDrawerAtom, (_draft: FocusDrawerState) => ({...initialFocusDrawerState}))
})

export const applyFocusDrawerStateAtom = atom(
    null,
    (_get, set, payload: Partial<FocusDrawerState>) => {
        set(focusDrawerAtom, (draft: FocusDrawerState) => {
            const next = {...draft, ...payload}
            draft.open = Boolean(next.open)
            draft.isClosing = Boolean(next.isClosing)
            draft.focusRunId = next.focusRunId ?? null
            draft.focusScenarioId = next.focusScenarioId ?? null
            draft.compareMode = next.compareMode
            draft.testcaseId = next.testcaseId
            draft.scenarioIndex = next.scenarioIndex
        })
    },
)

export const initialFocusDrawerStateAtom = atom(initialFocusDrawerState)

export interface FocusDrawerAtoms {
    focusTarget: FocusTarget | null
    isOpen: boolean
}

/**
 * Scenario info for comparison view in focus drawer
 */
export interface CompareScenarioInfo {
    runId: string
    scenarioId: string | null
    compareIndex: number
}

/**
 * Atom that finds matching scenarios across all compared runs
 * Returns array of {runId, scenarioId, compareIndex} for each run in comparison view
 */
export const compareScenarioMatchesAtom = atom<CompareScenarioInfo[]>((get) => {
    const focus = get(focusScenarioAtom)
    if (!focus || !focus.compareMode || !focus.focusRunId) {
        return []
    }

    const compareRunIds = get(compareRunIdsAtom)
    if (!compareRunIds.length) {
        return [{runId: focus.focusRunId, scenarioId: focus.focusScenarioId, compareIndex: 0}]
    }

    const results: CompareScenarioInfo[] = []

    // Add the base run scenario first
    results.push({
        runId: focus.focusRunId,
        scenarioId: focus.focusScenarioId,
        compareIndex: 0,
    })

    // Find matching scenarios in each comparison run
    compareRunIds.forEach((compareRunId, idx) => {
        if (!compareRunId) {
            results.push({runId: "", scenarioId: null, compareIndex: idx + 1})
            return
        }

        // Try to find matching scenario in this run
        const combinedRowsAtom = evaluationPreviewTableStore.atoms.combinedRowsAtomFamily({
            scopeId: compareRunId,
            pageSize: 1000, // Use a large page size to search through scenarios
        })

        const rows = get(combinedRowsAtom) as PreviewTableRow[]

        // First try to match by testcaseId
        let matchingScenario: PreviewTableRow | undefined
        if (focus.testcaseId) {
            matchingScenario = rows.find(
                (row) => !row.__isSkeleton && row.testcaseId === focus.testcaseId,
            )
        }

        // Fall back to scenarioIndex if no testcaseId match
        if (
            !matchingScenario &&
            focus.scenarioIndex !== undefined &&
            focus.scenarioIndex !== null
        ) {
            matchingScenario = rows.find(
                (row) => !row.__isSkeleton && row.scenarioIndex === focus.scenarioIndex,
            )
        }

        results.push({
            runId: compareRunId,
            scenarioId: matchingScenario?.scenarioId ?? matchingScenario?.id ?? null,
            compareIndex: idx + 1,
        })
    })

    return results
})
