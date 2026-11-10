import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {RunAnnotateBody} from "./RunAnnotateBody"
import {ScenarioFocusSkeleton} from "./states/ScenarioFocusSkeleton"
import {useRunAnnotationSession} from "./useRunAnnotationSession"
import {useScenarioInvocation} from "./useScenarioInvocation"

/**
 * Annotates one scenario of a human run without leaving the Scenarios tab. A page must load this
 * file with `next/dynamic`: it brings the annotation controllers.
 */
export const RunAnnotateSheet = ({
    runId,
    row,
    groups,
    labels,
    onRetry,
    onClose,
}: {
    runId: string
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    onRetry: () => void
    onClose: () => void
}) => {
    const {isOpen, onSaved} = useRunAnnotationSession(runId)
    const invocation = useScenarioInvocation(runId, row)

    return (
        <Sheet open onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                side="responsive"
                className="flex flex-col overflow-hidden max-lg:inset-0 max-lg:h-dvh max-lg:max-h-none max-lg:rounded-none lg:[--ag-sheet-responsive-width:1100px]"
            >
                <SheetHeader>
                    <SheetTitle>Annotate scenario</SheetTitle>
                    <SheetDescription>Scenario #{row.index}</SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-0 md:overflow-hidden">
                    {isOpen ? (
                        <RunAnnotateBody
                            runId={runId}
                            row={row}
                            groups={groups}
                            labels={labels}
                            onRetry={onRetry}
                            onSaved={onSaved}
                            invocation={invocation}
                        />
                    ) : (
                        <ScenarioFocusSkeleton />
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
