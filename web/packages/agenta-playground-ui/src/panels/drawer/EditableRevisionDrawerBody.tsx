import {useEffect, useState, type ReactNode} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {RevisionDetails} from "@agenta/entity-ui/variant"
import {LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {Segmented} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {ConfigPanel} from "../config/ConfigPanel"
import {ConfigPanelSkeleton} from "../config/ConfigPanelSkeleton"

import {DrawerCommitButton} from "./DrawerCommitButton"
import type {EditableRevisionDrawerKind} from "./types"
import {useDrawerPlaygroundSession} from "./useDrawerPlaygroundSession"

type Pane = "config" | "runs"

const PANES: {value: Pane; label: string}[] = [
    {value: "config", label: "Configuration"},
    {value: "runs", label: "Generations"},
]

export interface EditableRevisionDrawerBodyProps {
    revisionId: string
    kind: EditableRevisionDrawerKind
    testing: boolean
    canCommit: boolean
    canDeploy: boolean
    configActions?: ReactNode
    renderRuns: (revisionId: string) => ReactNode
    onCommitted: (newRevisionId: string) => void
    onRefinePrompt?: (revisionId: string, promptKey: string) => void
    /** False: leave the playground state alone (the drawer then has no test pane). */
    playground: boolean
}

/**
 * The drawer's body: the editable config, and beside it either the revision's details or, while
 * Test is on, the test pane. On a phone the test pane takes turns with the config.
 */
export const EditableRevisionDrawerBody = ({
    revisionId,
    kind,
    testing,
    canCommit,
    canDeploy,
    configActions,
    renderRuns,
    onCommitted,
    onRefinePrompt,
    playground,
}: EditableRevisionDrawerBodyProps) => {
    useDrawerPlaygroundSession(revisionId, playground)
    const twoPane = useMediaQuery("(min-width: 768px)")
    const [pane, setPane] = useState<Pane>("config")
    // Form, JSON or YAML: kept while the drawer is open, across previous and next.
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    const query = useAtomValue(workflowMolecule.atoms.query(revisionId))
    const local = isLocalDraftId(revisionId)
    // After the first load the config stays mounted and swaps revisions in place, as the playground does.
    const [loadedOnce, setLoadedOnce] = useState(false)
    useEffect(() => {
        if (query.data) setLoadedOnce(true)
    }, [query.data])

    if (!local && query.isError) {
        return (
            <LoadError
                className="m-4"
                title="Could not load this revision"
                onRetry={() => void query.refetch()}
            />
        )
    }
    if (!local && query.isPending && !loadedOnce) {
        return (
            <div className="min-h-0 flex-1" aria-busy="true">
                <ConfigPanelSkeleton />
            </div>
        )
    }
    if (!local && !query.isPending && !query.data) {
        return (
            <p className="text-muted-foreground m-0 p-6 text-center text-sm">
                This revision is no longer available.
            </p>
        )
    }

    const showConfig = !testing || twoPane || pane === "config"
    const showRuns = testing && (twoPane || pane === "runs")

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {testing && !twoPane ? (
                <div className="shrink-0 border-0 border-b border-solid border-border px-4 py-2">
                    <Segmented
                        block
                        size="sm"
                        options={PANES}
                        value={pane}
                        onChange={(value) => setPane(value as Pane)}
                    />
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
                {showConfig ? (
                    <div className="min-w-0 md:flex-1 md:overflow-y-auto">
                        <ConfigPanel
                            revisionId={revisionId}
                            readOnly={!canCommit}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                            onRefinePrompt={
                                onRefinePrompt
                                    ? (promptKey) => onRefinePrompt(revisionId, promptKey)
                                    : undefined
                            }
                            actions={
                                <>
                                    {configActions}
                                    <DrawerCommitButton
                                        revisionId={revisionId}
                                        canCommit={canCommit}
                                        canDeploy={canDeploy && kind !== "evaluator"}
                                        onCommitted={onCommitted}
                                    />
                                </>
                            }
                        />
                    </div>
                ) : null}
                {showRuns ? (
                    <div className="min-w-0 border-0 border-solid border-border md:w-1/2 md:shrink-0 md:overflow-y-auto md:border-l">
                        {renderRuns(revisionId)}
                    </div>
                ) : null}
                {!testing && !local ? (
                    <div className="shrink-0 border-0 border-t border-solid border-border p-4 md:w-72 md:overflow-y-auto md:border-t-0 md:border-l">
                        <RevisionDetails revisionId={revisionId} kind={kind} />
                    </div>
                ) : null}
            </div>
        </div>
    )
}
