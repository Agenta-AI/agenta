import type {CSSProperties} from "react"

import {Sheet, SheetContent} from "@agenta/ui/ui"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"

import type {DraftRevision, NewEvaluationKind} from "./newEvaluationDraft"
import {NewEvaluationForm} from "./NewEvaluationForm"
import {useStartEvaluation} from "./useStartEvaluation"

const SHEET_WIDTH = {"--ag-sheet-responsive-width": "640px"} as CSSProperties

/**
 * The sheet that starts an auto or a human evaluation. It has no route of its own: the runs list
 * opens it. Close, Escape and a click on the overlay do nothing while the start runs.
 */
export const NewEvaluationSheet = ({
    kind,
    projectId,
    base,
    appId,
    initialRevisions,
    onClose,
    onStarted,
}: {
    /** Null keeps the sheet closed. */
    kind: NewEvaluationKind | null
    projectId: string
    /** `/w/{workspace}/p/{project}` */
    base: string
    appId: string | null
    initialRevisions?: DraftRevision[]
    onClose: () => void
    onStarted: (kind: NewEvaluationKind) => void
}) => {
    const {start, isStarting} = useStartEvaluation({projectId, base})
    const evaluatorsViewOn = useDeveloperViewEnabled("evaluators") === true

    return (
        <Sheet open={kind !== null} onOpenChange={(next) => !next && !isStarting && onClose()}>
            <SheetContent
                side="right"
                style={SHEET_WIDTH}
                className="overflow-hidden"
                onEscapeKeyDown={(event) => isStarting && event.preventDefault()}
                onPointerDownOutside={(event) => isStarting && event.preventDefault()}
                onInteractOutside={(event) => isStarting && event.preventDefault()}
            >
                {kind ? (
                    <NewEvaluationForm
                        kind={kind}
                        appId={appId}
                        initialRevisions={initialRevisions}
                        evaluatorsHref={evaluatorsViewOn ? `${base}/evaluators` : null}
                        isStarting={isStarting}
                        start={start}
                        onClose={onClose}
                        onStarted={onStarted}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
