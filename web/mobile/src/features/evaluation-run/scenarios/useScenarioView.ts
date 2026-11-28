import {useCallback, useEffect, useState} from "react"

import {DEFAULT_SCENARIO_VIEW, parseScenarioView, type ScenarioView} from "./scenarioViewDefaults"

const storageKey = (runId: string) => `agenta:evaluation-run:scenario-view:${runId}`

function readView(runId: string): ScenarioView {
    try {
        const raw = window.localStorage.getItem(storageKey(runId))
        return raw ? parseScenarioView(JSON.parse(raw)) : DEFAULT_SCENARIO_VIEW
    } catch {
        return DEFAULT_SCENARIO_VIEW
    }
}

function writeView(runId: string, view: ScenarioView) {
    try {
        window.localStorage.setItem(storageKey(runId), JSON.stringify(view))
    } catch {
        // Without storage the view lasts until the page closes. Nothing else reads it.
    }
}

/**
 * The Scenarios table view of one run (density, row height, label column, hidden columns, order,
 * widths), kept in this browser. A change applies at once and is saved; there is no save step.
 * The one owner of the hidden columns.
 */
export function useScenarioView(runId: string) {
    const [state, setState] = useState(() => ({runId, view: readView(runId)}))
    // Another run reads its own view.
    const view = state.runId === runId ? state.view : readView(runId)
    if (state.runId !== runId) setState({runId, view})

    useEffect(() => {
        if (state.runId === runId && state.view !== DEFAULT_SCENARIO_VIEW) {
            writeView(runId, state.view)
        }
    }, [runId, state])

    const update = useCallback(
        (change: (current: ScenarioView) => ScenarioView) =>
            setState((current) => ({runId: current.runId, view: change(current.view)})),
        [],
    )
    return [view, update] as const
}
