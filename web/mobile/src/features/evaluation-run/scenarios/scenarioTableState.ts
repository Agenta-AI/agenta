import {EMPTY_SCENARIO_FILTER, type PredicateGroup} from "@agenta/entities/evaluationRun/etl"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"

/**
 * The applied scenario filter of each run. It stays while the page is open, so switching tabs and
 * back keeps it, as in the old app.
 */
export const scenarioFilterAtomFamily = atomFamily((_runId: string) =>
    atom<PredicateGroup>(EMPTY_SCENARIO_FILTER),
)

/** The keys of the columns the user hid, per run. */
export const hiddenScenarioColumnsAtomFamily = atomFamily((_runId: string) =>
    atom<ReadonlySet<string>>(new Set<string>()),
)
