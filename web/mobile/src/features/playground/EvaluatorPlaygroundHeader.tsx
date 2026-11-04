import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {AppPicker, RunOnSelector, type RunOnMode} from "@agenta/playground-ui/panels/evaluator"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

import {NavDrawer} from "../nav/NavDrawer"

/**
 * The evaluator playground's top bar: the evaluator's name, what it runs on, and in app mode the
 * app it runs on, with a button that disconnects it.
 */
export const EvaluatorPlaygroundHeader = ({
    workspaceId,
    projectId,
    evaluatorName,
    runOn,
    appLabel,
    onRunOnChange,
    onConnectApp,
    onDisconnectApp,
}: {
    workspaceId: string
    projectId: string
    evaluatorName: string | null
    runOn: RunOnMode
    /** The connected app's name, or null. */
    appLabel: string | null
    onRunOnChange: (mode: RunOnMode) => void
    onConnectApp: (app: WorkflowRevisionSelectionResult) => void
    onDisconnectApp: () => void
}) => (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2">
        <NavDrawer workspaceId={workspaceId} projectId={projectId} />
        <h1 className="m-0 min-w-0 truncate text-sm font-semibold text-foreground">
            {evaluatorName ?? "Evaluator"}
        </h1>
        <span className="shrink-0 text-sm text-muted-foreground">Playground</span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <RunOnSelector mode={runOn} onPick={onRunOnChange} />
            {runOn === "app" ? (
                <AppPicker selectedLabel={appLabel} onSelect={onConnectApp} />
            ) : null}
            {runOn === "app" && appLabel !== null ? (
                <SimpleTooltip title="Disconnect app" side="bottom">
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Disconnect app"
                        onClick={onDisconnectApp}
                    >
                        <X aria-hidden />
                    </Button>
                </SimpleTooltip>
            ) : null}
        </div>
    </header>
)
