import {useRouter} from "next/router"

/**
 * The run the scenario drawer shows: a compared run when `?focusRunId=` names one (a compared
 * run's row was opened), else the page's run.
 */
export function useFocusedRunId(runId: string, compareIds: readonly string[]): string {
    const value = useRouter().query.focusRunId
    return typeof value === "string" && compareIds.includes(value) ? value : runId
}
