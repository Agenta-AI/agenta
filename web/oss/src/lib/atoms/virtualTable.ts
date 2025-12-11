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
