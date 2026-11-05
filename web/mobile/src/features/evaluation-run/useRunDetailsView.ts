import {useCallback} from "react"

import {isTerminalRunStatus, type RunHeader} from "@agenta/entities/evaluationRun"
import {useRouter} from "next/router"

export type RunDetailsView = "overview" | "scenarios" | "configuration" | "focus"

export interface RunDetailsTab {
    value: RunDetailsView
    label: string
}

const BASE_TABS: readonly RunDetailsTab[] = [
    {value: "overview", label: "Overview"},
    {value: "scenarios", label: "Scenarios"},
    {value: "configuration", label: "Configuration"},
]
const ANNOTATE_TAB: RunDetailsTab = {value: "focus", label: "Annotate"}

/** The tabs a run has: Annotate only on a human run. */
export function runDetailsTabs(header: Pick<RunHeader, "kind"> | null): RunDetailsTab[] {
    return header?.kind === "human" ? [...BASE_TABS, ANNOTATE_TAB] : [...BASE_TABS]
}

/** A human run still being annotated opens on Annotate; every other run opens on Overview. */
export function defaultRunDetailsView(
    header: Pick<RunHeader, "kind" | "status"> | null,
): RunDetailsView {
    return header?.kind === "human" && !isTerminalRunStatus(header.status) ? "focus" : "overview"
}

/**
 * The open tab, kept in `?view=`. A missing or unknown value falls back to the run's default
 * tab; a change replaces the address without a new history entry.
 */
export function useRunDetailsView(header: RunHeader | null) {
    const router = useRouter()
    const tabs = runDetailsTabs(header)
    const requested = router.query.view
    const view = tabs.find((tab) => tab.value === requested)?.value ?? defaultRunDetailsView(header)

    const setView = useCallback(
        (next: string) =>
            void router.replace(
                {pathname: router.pathname, query: {...router.query, view: next}},
                undefined,
                {shallow: true},
            ),
        [router],
    )

    return {tabs, view, setView}
}
