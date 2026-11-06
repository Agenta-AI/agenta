import {Sheet, SheetContent} from "@agenta/ui/ui"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"

import type {DraftRevision, NewEvaluationKind} from "./newEvaluationDraft"
import {NewEvaluationForm} from "./NewEvaluationForm"
import {SHEET_FRAME} from "./sheetFrame"
import {useStartEvaluation} from "./useStartEvaluation"

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
    allowAutomaticCreate = false,
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
    /** Create an automatic evaluator in the editable drawer; off inside a playground. */
    allowAutomaticCreate?: boolean
}) => {
    const {start, isStarting} = useStartEvaluation({projectId, base})
    const evaluatorsViewOn = useDeveloperViewEnabled("evaluators") === true

    return (
        <Sheet open={kind !== null} onOpenChange={(next) => !next && !isStarting && onClose()}>
            <SheetContent
                {...SHEET_FRAME}
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
                        allowAutomaticCreate={allowAutomaticCreate}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
