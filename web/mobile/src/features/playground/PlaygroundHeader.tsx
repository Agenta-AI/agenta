import {EvaluatorPicker} from "@agenta/playground-ui/panels/evaluator"

import {NavDrawer} from "../nav/NavDrawer"

/** The playground's top bar: the app's name, what this page is, and the evaluators that score it. */
export const PlaygroundHeader = ({
    workspaceId,
    projectId,
    appName,
}: {
    workspaceId: string
    projectId: string
    appName: string | null
}) => (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <NavDrawer workspaceId={workspaceId} projectId={projectId} />
        <h1 className="m-0 min-w-0 truncate text-sm font-semibold text-foreground">{appName}</h1>
        <span className="shrink-0 text-sm text-muted-foreground">Playground</span>
        <div className="ml-auto flex min-w-0 justify-end">
            <EvaluatorPicker />
        </div>
    </header>
)
