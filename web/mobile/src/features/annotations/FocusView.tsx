import {annotationSessionController} from "@agenta/annotation"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotationFormPanel} from "./AnnotationFormPanel"
import {FocusFooter} from "./FocusFooter"
import {ScenarioContent} from "./ScenarioContent"
import {ScenarioMessage} from "./ScenarioMessage"
import {AllCaughtUp} from "./states/AllCaughtUp"
import {useAnnotationKeyboardShortcuts} from "./useAnnotationKeyboardShortcuts"
import {useSubmitAnnotations} from "./useSubmitAnnotations"

/**
 * One item at a time: what to annotate on the left, the form on the right, and the bar to move
 * between items and save. On a phone the parts stack and the page scrolls.
 */
export const FocusView = ({
    queueId,
    observabilityHref,
}: {
    queueId: string
    observabilityHref: string
}) => {
    const currentId = useAtomValue(annotationSessionController.selectors.currentScenarioId())
    const scenarioId = currentId ?? ""
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())
    const scenarios = useAtomValue(annotationSessionController.selectors.scenarioRecords())
    const focusIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const isTraces = useAtomValue(annotationSessionController.selectors.queueKind()) !== "testcases"
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const submission = useSubmitAnnotations(scenarioId, queueId)

    useAnnotationKeyboardShortcuts({
        onPrev: () => navigatePrev(),
        onNext: () => navigateNext(),
        onSubmit: () => void submission.submit(),
        hasPrev,
        hasNext,
        canSubmit: submission.canSubmit,
        enabled: Boolean(currentId),
    })

    if (scenariosQuery.isError)
        return <ScenarioMessage title="Failed to load annotation scenarios" />
    if (scenarios.length === 0) return <ScenarioMessage title="No scenarios available" />
    if (progress.remaining === 0) return <AllCaughtUp observabilityHref={observabilityHref} />
    if (focusIds.length === 0 && !currentId) {
        return (
            <ScenarioMessage
                title="No scenarios available"
                detail="Adjust the focus switches to continue annotating."
            />
        )
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-2 md:overflow-hidden">
                <div className="flex flex-col gap-3 md:h-full md:flex-row md:gap-4">
                    <div className="min-w-0 rounded-lg border border-solid border-border bg-background md:flex-1 md:overflow-y-auto">
                        <ScenarioContent
                            hasScenario={scenarios.some((record) => record.id === currentId)}
                            isTraces={isTraces}
                            traceId={traceRef.traceId}
                            testcaseId={testcaseRef.testcaseId}
                        />
                    </div>
                    <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-solid border-border bg-background md:w-[300px] lg:w-[400px] xl:w-[450px]">
                        <AnnotationFormPanel scenarioId={scenarioId} queueId={queueId} />
                    </div>
                </div>
            </div>
            <div className="flex h-[55px] shrink-0 items-center border-0 border-t border-solid border-border bg-background px-3 sm:px-4">
                <FocusFooter scenarioId={scenarioId} submission={submission} />
            </div>
        </div>
    )
}
