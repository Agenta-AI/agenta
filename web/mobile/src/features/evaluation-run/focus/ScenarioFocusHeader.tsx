import type {ComponentProps, ReactNode} from "react"

import {SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {CompareRowRun} from "../compare/scenarios/CompareRowRun"

import {ScenarioFocusToolbar} from "./ScenarioFocusToolbar"
import {ScenarioNavigator} from "./ScenarioNavigator"
import {scenarioNoun} from "./scenarioNoun"

/**
 * The drawer's title with its link and tools, while comparing the run it shows, the summary line
 * of the test case, and the navigator.
 */
export const ScenarioFocusHeader = ({
    toolbar,
    compareRun = null,
    link,
    summary,
    ...props
}: ComponentProps<typeof ScenarioNavigator> & {
    toolbar: ComponentProps<typeof ScenarioFocusToolbar>
    compareRun?: {slot: number; name: string} | null
    /** "Open in test set", when the run has one. */
    link: ReactNode
    /** The passed count, duration, tokens and cost. */
    summary: ReactNode
}) => (
    <SheetHeader className="pb-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <SheetTitle>
                {scenarioNoun(props.kind)} #{props.current.index}
            </SheetTitle>
            <div className="flex shrink-0 items-center gap-1">
                {link}
                <ScenarioFocusToolbar {...toolbar} />
            </div>
        </div>
        {compareRun ? <CompareRowRun slot={compareRun.slot} name={compareRun.name} /> : null}
        {summary}
        <div className="pt-3">
            <ScenarioNavigator {...props} />
        </div>
    </SheetHeader>
)
