import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export type ScenarioRowHeight = "small" | "medium" | "large"

export const ROW_HEIGHT_CONFIG: Record<ScenarioRowHeight, {height: number; label: string}> = {
    small: {height: 80, label: "Small"},
    medium: {height: 160, label: "Medium"},
    large: {height: 280, label: "Large"},
}

export const DEFAULT_ROW_HEIGHT: ScenarioRowHeight = "medium"

/**
 * Persisted atom for scenario table row height preference.
 * Stored in localStorage with key "agenta:scenario-table:row-height"
 */
export const scenarioRowHeightAtom = atomWithStorage<ScenarioRowHeight>(
    "agenta:scenario-table:row-height",
    DEFAULT_ROW_HEIGHT,
)

/**
 * Derived atom that returns the actual pixel height for the current row height setting
 */
export const scenarioRowHeightPxAtom = atom((get) => {
    const height = get(scenarioRowHeightAtom)
    return ROW_HEIGHT_CONFIG[height].height
})
