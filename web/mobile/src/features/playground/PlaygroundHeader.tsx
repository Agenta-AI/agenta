import type {ReactNode} from "react"

import {EvaluatorPicker} from "@agenta/playground-ui/panels/evaluator"

import {NavDrawer} from "../nav/NavDrawer"

/**
 * The playground's top bar: the app's name, what this page is, the evaluators that score it, and
 * the page's actions.
 */
export const PlaygroundHeader = ({
    workspaceId,
    projectId,
    appName,
    newEvaluation,
    actions,
}: {
    workspaceId: string
    projectId: string
    appName: string | null
    /** "New Evaluation", first and set apart from the rest, as in the old playground. */
    newEvaluation?: ReactNode
    actions?: ReactNode
}) => (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <NavDrawer workspaceId={workspaceId} projectId={projectId} />
        <h1 className="m-0 min-w-16 truncate text-sm font-semibold text-foreground">{appName}</h1>
        {/* On a phone the app name gets the room: the pane switch below says where you are. */}
        <span className="shrink-0 text-sm text-muted-foreground max-sm:hidden">Playground</span>
        <div className="ml-auto flex items-center justify-end gap-2">
            {newEvaluation}
            {newEvaluation ? <span aria-hidden className="h-4 w-px shrink-0 bg-border" /> : null}
            <EvaluatorPicker />
            {actions}
        </div>
    </header>
)
