import type {CSSProperties} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotationFormPanel} from "./AnnotationFormPanel"
import {ScenarioContent} from "./ScenarioContent"
import {readScenarioRef} from "./scenarioRefs"

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
    const records = useAtomValue(annotationSessionController.selectors.scenarioRecords())
    const isTraces = useAtomValue(annotationSessionController.selectors.queueKind()) !== "testcases"
    const traceRef = useAtomValue(annotationSessionController.selectors.scenarioTraceRef(id))
    const testcaseRef = useAtomValue(annotationSessionController.selectors.scenarioTestcaseRef(id))
    const scenario =
        (records.find((record) => record.id === scenarioId) as
            | Record<string, unknown>
            | undefined) ?? null
    const traceId = isTraces ? readScenarioRef(scenario, "trace_id") || traceRef.traceId : ""
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId || null))
    const openTrace = useSetAtom(openTraceDrawerAtom)

    return (
        <Sheet open={scenarioId !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent
                side="right"
                style={SHEET_WIDTH}
                className="flex flex-col overflow-hidden"
            >
                <SheetHeader>
                    <SheetTitle>Annotate Scenario</SheetTitle>
                    <SheetDescription className="sr-only">
                        Rate this item and mark it completed.
                    </SheetDescription>
                    {traceId ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={() =>
                                openTrace({traceId, activeSpanId: rootSpan?.span_id ?? null})
                            }
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
                                scenario={scenario}
                                isTraces={isTraces}
                                traceId={traceId}
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
