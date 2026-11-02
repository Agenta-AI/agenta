import type {CSSProperties} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AnnotationFormPanel} from "./AnnotationFormPanel"
import {ScenarioContent} from "./ScenarioContent"
import {useScenarioTraceOpener} from "./useScenarioTraceOpener"

const SHEET_WIDTH = {"--ag-sheet-responsive-width": "1100px"} as CSSProperties

/**
 * Annotates one item without leaving the list: its content beside the form, which carries its own
 * Mark completed button. Trace queues can open the full trace.
 */
export const AnnotateScenarioSheet = ({
    scenarioId,
    queueId,
    onClose,
}: {
    scenarioId: string | null
    queueId: string
    onClose: () => void
}) => {
    const id = scenarioId ?? ""
    const isTraces = useAtomValue(annotationSessionController.selectors.queueKind()) !== "testcases"
    const traceRef = useAtomValue(annotationSessionController.selectors.scenarioTraceRef(id))
    const testcaseRef = useAtomValue(annotationSessionController.selectors.scenarioTestcaseRef(id))
    const openTrace = useScenarioTraceOpener(id)

    return (
        <Sheet open={scenarioId !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent
                side="responsive"
                style={SHEET_WIDTH}
                className="flex flex-col overflow-hidden"
            >
                <SheetHeader>
                    <SheetTitle>Annotate Scenario</SheetTitle>
                    <SheetDescription className="sr-only">
                        Rate this item and mark it completed.
                    </SheetDescription>
                    {openTrace ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={openTrace}
                        >
                            <ArrowSquareOut aria-hidden size={14} />
                            View Full Trace
                        </Button>
                    ) : null}
                </SheetHeader>
                {scenarioId ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
                        <div className="min-w-0 rounded-lg border border-solid border-border md:flex-1 md:overflow-y-auto">
                            <ScenarioContent
                                hasScenario
                                isTraces={isTraces}
                                traceId={traceRef.traceId}
                                testcaseId={testcaseRef.testcaseId}
                            />
                        </div>
                        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-solid border-border md:w-[340px]">
                            <AnnotationFormPanel
                                scenarioId={scenarioId}
                                queueId={queueId}
                                showSubmit
                            />
                        </div>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
