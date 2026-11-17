import type {ComponentProps} from "react"

import {SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {ScenarioFocusToolbar} from "./ScenarioFocusToolbar"
import {ScenarioNavigator} from "./ScenarioNavigator"
import {scenarioNoun} from "./scenarioNoun"

/** The drawer's title and tools over the scenario navigator. */
export const ScenarioFocusHeader = ({
    toolbar,
    ...props
}: ComponentProps<typeof ScenarioNavigator> & {
    toolbar: ComponentProps<typeof ScenarioFocusToolbar>
}) => (
    <SheetHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <SheetTitle>
                {scenarioNoun(props.kind)} #{props.current.index}
            </SheetTitle>
            <ScenarioFocusToolbar {...toolbar} />
        </div>
        <div className="pt-2">
            <ScenarioNavigator {...props} />
        </div>
    </SheetHeader>
)
