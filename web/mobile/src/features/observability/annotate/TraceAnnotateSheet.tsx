import {useState} from "react"

import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {projectIdAtom} from "@agenta/shared/state"
import {
    Alert,
    Button,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {ArrowLeftIcon, PlusIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SelectEvaluatorsStep} from "./SelectEvaluatorsStep"
import {TraceAnnotateEmpty} from "./states/TraceAnnotateEmpty"
import {TraceAnnotateSections} from "./TraceAnnotateSections"
import {useAnnotateEvaluatorSelection} from "./useAnnotateEvaluatorSelection"
import {useEvaluatorsHref} from "./useEvaluatorsHref"
import {useHumanEvaluators} from "./useHumanEvaluators"
import {useTraceAnnotationForm} from "./useTraceAnnotationForm"

const Message = ({children}: {children: string}) => (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {children}
    </div>
)

/**
 * Annotates the active span of the trace drawer: the Annotate step edits the user's own
 * annotations and the picked evaluators; the Select Evaluators step picks evaluators.
 */
export const TraceAnnotateSheet = ({
    traceId,
    spanId,
    annotations,
    onClose,
}: {
    traceId: string
    spanId: string
    annotations: readonly AnnotationDto[]
    onClose: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [step, setStep] = useState<"annotate" | "select">("annotate")
    const {selected, setSelected} = useAnnotateEvaluatorSelection(projectId)
    const humanEvaluators = useHumanEvaluators()
    const evaluatorsHref = useEvaluatorsHref()
    const form = useTraceAnnotationForm({
        traceId,
        spanId,
        annotations,
        selectedSlugs: selected,
        onSaved: onClose,
    })
    const selecting = step === "select"

    const annotateBody =
        form.isLoading && form.sections.length === 0 ? (
            <Message>Loading evaluators...</Message>
        ) : form.sections.length === 0 ? (
            <TraceAnnotateEmpty onAddEvaluator={() => setStep("select")} />
        ) : (
            <TraceAnnotateSections
                sections={form.sections}
                errors={form.errors}
                onChange={form.setValue}
            />
        )

    return (
        <Sheet open onOpenChange={(next) => !next && !form.isSaving && onClose()}>
            <SheetContent
                side="right"
                className="flex w-full flex-col overflow-hidden max-sm:inset-0 max-sm:rounded-none sm:w-[440px] sm:max-w-[calc(100vw-1rem)]"
            >
                <SheetHeader>
                    <div className="flex min-w-0 items-center gap-2">
                        {selecting ? (
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Back"
                                onClick={() => setStep("annotate")}
                            >
                                <ArrowLeftIcon size={16} />
                            </Button>
                        ) : null}
                        <SheetTitle className="min-w-0 flex-1 truncate">
                            {selecting ? "Select Evaluators" : "Annotate"}
                        </SheetTitle>
                        {selecting ? (
                            <Button
                                size="sm"
                                disabled={selected.length === 0 && form.ownSlugs.length === 0}
                                onClick={() => setStep("annotate")}
                            >
                                Annotate
                            </Button>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={form.isSaving}
                                    onClick={() => setStep("select")}
                                >
                                    <PlusIcon size={14} />
                                    Add Evaluator
                                </Button>
                                <LoadingButton
                                    size="sm"
                                    loading={form.isSaving}
                                    disabled={!form.hasChanges || form.isSaving}
                                    onClick={() => void form.save()}
                                >
                                    Save
                                </LoadingButton>
                            </>
                        )}
                    </div>
                    <SheetDescription className="sr-only">
                        Rate the selected span with your human evaluators.
                    </SheetDescription>
                </SheetHeader>
                {!selecting && form.hasError ? (
                    <Alert
                        banner
                        type="warning"
                        showIcon
                        message="Some evaluators could not be loaded. Loaded evaluator fields are still available."
                    />
                ) : null}
                {/* Inert while saving: an edit made then would be lost when the sheet closes. */}
                <div inert={form.isSaving} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {selecting ? (
                        <div className="p-4">
                            <SelectEvaluatorsStep
                                evaluators={humanEvaluators.evaluators}
                                isLoading={humanEvaluators.isLoading}
                                loadFailed={humanEvaluators.isError}
                                onRetry={humanEvaluators.retry}
                                selected={selected}
                                lockedSlugs={form.ownSlugs}
                                onChange={setSelected}
                                evaluatorsHref={evaluatorsHref}
                            />
                        </div>
                    ) : (
                        annotateBody
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}

export default TraceAnnotateSheet
