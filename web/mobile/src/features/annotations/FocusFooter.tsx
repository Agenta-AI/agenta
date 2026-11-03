import {annotationSessionController, getAddToTestsetDisabledReason} from "@agenta/annotation"
import {useModifierKey} from "@agenta/shared/hooks"
import {useMediaQuery} from "@agenta/ui/hooks"
import {Button, Kbd, LoadingButton, SimpleTooltip} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {FocusScenarioPicker} from "./FocusScenarioPicker"
import {FocusSwitches} from "./FocusSwitches"
import {useScenarioTraceOpener} from "./useScenarioTraceOpener"
import type {useSubmitAnnotations} from "./useSubmitAnnotations"

const WIDE_QUERY = "(min-width: 1024px)"

/**
 * The focus view's bar: the item picker on the left; the switches, Prev and Next, Add to Testset
 * and Mark completed on the right. On narrow screens the switches fold into a menu and the key
 * hints go.
 */
export const FocusFooter = ({
    scenarioId,
    submission,
}: {
    scenarioId: string
    submission: ReturnType<typeof useSubmitAnnotations>
}) => {
    const wide = useMediaQuery(WIDE_QUERY)
    const openTrace = useScenarioTraceOpener(scenarioId)
    const modifierKey = useModifierKey()
    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const isExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const openAddToTestset = useSetAtom(annotationSessionController.actions.openAddToTestsetModal)

    const addDisabledReason = getAddToTestsetDisabledReason({
        scenarioId,
        isCompleted: submission.isCompleted,
        isSubmitting: submission.isSubmitting,
        hasPendingChanges: submission.hasPendingChanges,
    })

    return (
        <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:gap-4">
            <FocusScenarioPicker scenarioId={scenarioId} compact={!wide} />
            <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:gap-4">
                <FocusSwitches compact={!wide} onOpenTrace={openTrace} />
                <div className="flex items-center gap-1 sm:gap-2">
                    <Button
                        type="button"
                        size={wide ? "sm" : "icon-sm"}
                        variant="outline"
                        disabled={!hasPrev}
                        onClick={() => navigatePrev()}
                        aria-label={wide ? undefined : "Prev"}
                    >
                        <CaretLeft aria-hidden size={13} />
                        {wide ? (
                            <>
                                Prev <Kbd>←</Kbd>
                            </>
                        ) : null}
                    </Button>
                    <Button
                        type="button"
                        size={wide ? "sm" : "icon-sm"}
                        variant="outline"
                        disabled={!hasNext}
                        onClick={() => navigateNext()}
                        aria-label={wide ? undefined : "Next"}
                    >
                        {wide ? (
                            <>
                                Next <Kbd>→</Kbd>
                            </>
                        ) : null}
                        <CaretRight aria-hidden size={13} />
                    </Button>
                    <SimpleTooltip title={addDisabledReason ?? undefined}>
                        {/* A disabled button gets no pointer events; the span carries the tooltip. */}
                        <span className="inline-flex">
                            <LoadingButton
                                type="button"
                                size={wide ? "sm" : "icon-sm"}
                                variant="outline"
                                loading={isExporting}
                                disabled={Boolean(addDisabledReason)}
                                aria-label={wide ? undefined : "Add to Testset"}
                                onClick={() =>
                                    openAddToTestset({scope: "single", scenarioIds: [scenarioId]})
                                }
                            >
                                <Plus aria-hidden size={13} />
                                {wide ? "Add to Testset" : null}
                            </LoadingButton>
                        </span>
                    </SimpleTooltip>
                    <LoadingButton
                        type="button"
                        size="sm"
                        loading={submission.isSubmitting}
                        disabled={!submission.canSubmit}
                        onClick={() => void submission.submit()}
                        className="sm:min-w-[160px]"
                    >
                        {submission.label}
                        {wide ? (
                            <Kbd tone="inverse" className="ml-0.5">{`${modifierKey}↵`}</Kbd>
                        ) : null}
                    </LoadingButton>
                </div>
            </div>
        </div>
    )
}
