import {Sheet, SheetContent} from "@agenta/ui/ui"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"
import {SHEET_FRAME} from "../new/sheetFrame"

import {LiveEvaluationForm} from "./LiveEvaluationForm"
import {useCreateLiveEvaluation} from "./useCreateLiveEvaluation"
import type {LiveEvaluationDraft} from "./useLiveEvaluationForm"

/**
 * The sheet that creates a live evaluation. It has no route of its own: the runs list opens it.
 * Close, Escape and a click on the overlay do nothing while the create runs.
 */
export const LiveEvaluationSheet = ({
    open,
    projectId,
    base,
    initial,
    onClose,
    onCreated,
}: {
    open: boolean
    projectId: string
    /** `/w/{workspace}/p/{project}` */
    base: string
    /** Starting values over the empty form, for a story or a test. */
    initial?: Partial<LiveEvaluationDraft>
    onClose: () => void
    onCreated: () => void
}) => {
    const {create, isCreating} = useCreateLiveEvaluation({projectId, base})
    const evaluatorsViewOn = useDeveloperViewEnabled("evaluators") === true

    return (
        <Sheet open={open} onOpenChange={(next) => !next && !isCreating && onClose()}>
            <SheetContent
                {...SHEET_FRAME}
                onEscapeKeyDown={(event) => isCreating && event.preventDefault()}
                onPointerDownOutside={(event) => isCreating && event.preventDefault()}
                onInteractOutside={(event) => isCreating && event.preventDefault()}
            >
                {open ? (
                    <LiveEvaluationForm
                        evaluatorsHref={evaluatorsViewOn ? `${base}/evaluators` : null}
                        isCreating={isCreating}
                        create={create}
                        onClose={onClose}
                        onCreated={onCreated}
                        initial={initial}
                    />
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
