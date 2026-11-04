import {useCallback} from "react"

import {useRouter} from "next/router"

const SCENARIO_PARAM = "focusScenarioId"
const RUN_PARAM = "focusRunId"

/**
 * The focused scenario, kept in the URL as `?focusScenarioId=` and `?focusRunId=` (the /w names,
 * so /w links open here too). The URL is the drawer's only open state. `setScenarioId(null)`
 * closes the drawer and removes both parameters.
 */
export const useFocusScenarioParam = (runId: string) => {
    const router = useRouter()
    const value = router.query[SCENARIO_PARAM]
    const scenarioId = typeof value === "string" && value ? value : null

    const setScenarioId = useCallback(
        (next: string | null) => {
            const {[SCENARIO_PARAM]: _scenario, [RUN_PARAM]: _run, ...rest} = router.query
            void router.replace(
                {
                    pathname: router.pathname,
                    query: next ? {...rest, [SCENARIO_PARAM]: next, [RUN_PARAM]: runId} : rest,
                },
                undefined,
                {shallow: true},
            )
        },
        [router, runId],
    )

    return [scenarioId, setScenarioId] as const
}
