import {atom} from "jotai"

import type {AutomationKind} from "./automationModel"

/** Which automation's runs the drawer shows; null closes it. */
export interface AutomationRunHistoryDrawerState {
    automationId: string
    kind: AutomationKind
}

/**
 * The run history drawer's opener. Atom-driven like the automation drawer, so a playground row's
 * "Run history" and a session row's land on the same surface without a route.
 */
export const automationRunHistoryDrawerAtom = atom<AutomationRunHistoryDrawerState | null>(null)
