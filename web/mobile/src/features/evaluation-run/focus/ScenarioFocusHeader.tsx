import type {ComponentProps} from "react"

import {SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {CompareRowRun} from "../compare/scenarios/CompareRowRun"

import {ScenarioFocusToolbar} from "./ScenarioFocusToolbar"
import {ScenarioNavigator} from "./ScenarioNavigator"
import {scenarioNoun} from "./scenarioNoun"

/** The drawer's title and tools over the scenario navigator; while comparing, the run it shows. */
export const ScenarioFocusHeader = ({
    toolbar,
    compareRun = null,
    ...props
}: ComponentProps<typeof ScenarioNavigator> & {
    toolbar: ComponentProps<typeof ScenarioFocusToolbar>
    compareRun?: {slot: number; name: string} | null
}) => (
    <SheetHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <SheetTitle>
                {scenarioNoun(props.kind)} #{props.current.index}
            </SheetTitle>
            <ScenarioFocusToolbar {...toolbar} />
        </div>
        {compareRun ? <CompareRowRun slot={compareRun.slot} name={compareRun.name} /> : null}
        <div className="pt-2">
            <ScenarioNavigator {...props} />
        </div>
    </SheetHeader>
)
