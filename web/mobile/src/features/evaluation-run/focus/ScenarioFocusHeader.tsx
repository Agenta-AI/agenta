import type {ComponentProps} from "react"

import {SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {ScenarioNavigator} from "./ScenarioNavigator"
import {scenarioNoun} from "./scenarioNoun"

/** The drawer's title over the scenario navigator. */
export const ScenarioFocusHeader = (props: ComponentProps<typeof ScenarioNavigator>) => (
    <SheetHeader>
        <SheetTitle>
            {scenarioNoun(props.kind)} #{props.current.index}
        </SheetTitle>
        <div className="pt-2">
            <ScenarioNavigator {...props} />
        </div>
    </SheetHeader>
)
