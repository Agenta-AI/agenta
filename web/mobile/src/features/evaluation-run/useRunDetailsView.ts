import {useCallback} from "react"

import {useRouter} from "next/router"

export type RunDetailsView = "overview" | "scenarios" | "configuration"

export interface RunDetailsTab {
    value: RunDetailsView
    label: string
}

export const RUN_DETAILS_TABS: readonly RunDetailsTab[] = [
    {value: "overview", label: "Overview"},
    {value: "scenarios", label: "Scenarios"},
    {value: "configuration", label: "Configuration"},
]

/**
 * The open tab, kept in `?view=`. A missing or unknown value opens Overview; a change replaces
 * the address without a new history entry.
 */
export function useRunDetailsView() {
    const router = useRouter()
    const requested = router.query.view
    const view = RUN_DETAILS_TABS.find((tab) => tab.value === requested)?.value ?? "overview"

    const setView = useCallback(
        (next: string) =>
            void router.replace(
                {pathname: router.pathname, query: {...router.query, view: next}},
                undefined,
                {shallow: true},
            ),
        [router],
    )

    return {tabs: RUN_DETAILS_TABS, view, setView}
}
