import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {DEFAULT_SCENARIO_PAGE_SIZE} from "./constants"

export const tableScenarioPageAtomFamily = atomFamily((runId: string) => atom(0))

export const tableScenarioPageSizeAtomFamily = atomFamily((runId: string) =>
    atom(DEFAULT_SCENARIO_PAGE_SIZE),
)

export const tableScenarioOffsetAtomFamily = atomFamily((runId: string) =>
    atom(
        (get) =>
            get(tableScenarioPageAtomFamily(runId)) * get(tableScenarioPageSizeAtomFamily(runId)),
    ),
)
