import {Button} from "@agenta/ui/ui"

import type {ScenarioInvocationState} from "./useScenarioInvocation"

/** Where the form will be: the scenario has no app output yet, and Run asks the app for it. */
export const RunInvocationPanel = ({invocation}: {invocation: ScenarioInvocationState}) => {
    const {running, failed, run} = invocation
    return (
        <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <span className="text-sm text-muted-foreground">
                {running ? "Generating output..." : "Generate output to annotate"}
            </span>
            {failed && !running ? (
                <p role="alert" className="m-0 text-sm text-destructive">
                    Couldn't run this scenario
                </p>
            ) : null}
            <Button size="sm" onClick={run} disabled={running}>
                {running ? "Running..." : failed ? "Run again" : "Run"}
            </Button>
        </div>
    )
}
