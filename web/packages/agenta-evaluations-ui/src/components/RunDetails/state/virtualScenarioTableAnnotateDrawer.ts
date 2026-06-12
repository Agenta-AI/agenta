/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval run-details view; OSS-owned loose payload shapes (see §11.4) */
import {atom} from "jotai"

// Global annotate drawer state for VirtualizedScenarioTable
export interface VirtualScenarioTableAnnotateDrawerState {
    open: boolean
    scenarioId?: string
    runId?: string
    title?: string
    context?: Record<string, any>
}

export const virtualScenarioTableAnnotateDrawerAtom = atom<VirtualScenarioTableAnnotateDrawerState>(
    {
        open: false,
        scenarioId: undefined,
        runId: undefined,
        title: "Annotate scenario",
        context: undefined,
    },
)
