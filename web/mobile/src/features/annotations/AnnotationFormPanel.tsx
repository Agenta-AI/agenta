import {useEffect, useMemo, useState} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Alert,
    LoadingButton,
} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotationEvaluatorSection} from "./AnnotationEvaluatorSection"
import {AnnotationPanelHeader} from "./AnnotationPanelHeader"
import {useAnnotationFormState} from "./useAnnotationFormState"
import {SUBMIT_FAILURE_TEXT, useSubmitAnnotations} from "./useSubmitAnnotations"

const PanelMessage = ({children}: {children: string}) => (
    <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {children}
    </div>
)

/** The form belongs to a queue's item, or to a scenario of an evaluation run. */
type FormScope = {queueId: string; runId?: never} | {runId: string; queueId?: never}

/**
 * The form for one scenario: one open section per evaluator, its metrics as fields. With
 * `showSubmit` (the annotate sheets, the run's Annotate tab) it carries its own submit button; in
 * the queue focus view the footer has it. `readOnly` shows the values without the button.
 */
export const AnnotationFormPanel = ({
    scenarioId,
    showSubmit = false,
    readOnly = false,
    onSaved,
    ...scope
}: FormScope & {
    scenarioId: string
    showSubmit?: boolean
    readOnly?: boolean
    onSaved?: (scenarioId: string) => void
}) => {
    const inRun = Boolean(scope.runId)
    const {metrics, evaluators, evaluatorResolution, updateMetric} =
        useAnnotationFormState(scenarioId)
    const stepRefs = useAtomValue(annotationSessionController.selectors.evaluatorStepRefs())
    const description = useAtomValue(annotationSessionController.selectors.queueDescription())
    const submitError = useAtomValue(annotationFormController.selectors.submitError(scenarioId))
    const clearSubmitError = useSetAtom(annotationFormController.actions.clearSubmitError)
    const submission = useSubmitAnnotations(
        scenarioId,
        scope.runId ? {runId: scope.runId} : {queueId: scope.queueId ?? ""},
        onSaved,
    )

    const sections = useMemo(
        () =>
            evaluators.filter((evaluator): evaluator is typeof evaluator & {slug: string} =>
                Boolean(evaluator.slug),
            ),
        [evaluators],
    )
    const slugKey = sections.map((evaluator) => evaluator.slug).join("|")
    const [open, setOpen] = useState<string[]>([])
    // Every section opens again when the evaluator list changes.
    useEffect(() => {
        setOpen(slugKey ? slugKey.split("|") : [])
    }, [slugKey])

    const header = (
        <AnnotationPanelHeader
            description={description}
            isCompleted={inRun ? undefined : submission.isCompleted}
        />
    )
    const nothingLoaded = stepRefs.length > 0 && evaluators.length === 0
    const panelMessage =
        stepRefs.length === 0
            ? inRun
                ? "No evaluators configured for this run."
                : "No evaluators configured for this queue"
            : nothingLoaded && evaluatorResolution.isPending
              ? "Loading evaluators..."
              : nothingLoaded
                ? `Could not load evaluator schemas for this ${inRun ? "run" : "queue"}`
                : null
    if (panelMessage) {
        return (
            <div className="flex h-full min-h-0 flex-col">
                {header}
                <PanelMessage>{panelMessage}</PanelMessage>
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {header}
            {submitError ? (
                <Alert
                    banner
                    type="warning"
                    showIcon
                    closable
                    message={SUBMIT_FAILURE_TEXT}
                    onClose={() => clearSubmitError(scenarioId)}
                />
            ) : null}
            {evaluatorResolution.hasError ? (
                <Alert
                    banner
                    type="warning"
                    showIcon
                    message="Some evaluators could not be loaded. Loaded evaluator fields are still available."
                />
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <Accordion type="multiple" variant="ghost" value={open} onValueChange={setOpen}>
                    {sections.map((evaluator) => (
                        <AccordionItem
                            key={evaluator.slug}
                            value={evaluator.slug}
                            className="border-0 border-b border-solid border-border"
                        >
                            <AccordionTrigger className="bg-muted px-3 py-2.5">
                                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                    <span
                                        className="min-w-0 truncate"
                                        title={evaluator.name ?? evaluator.slug}
                                    >
                                        {evaluator.name ?? evaluator.slug}
                                    </span>
                                    <span
                                        className="min-w-0 max-w-[40%] truncate text-xs text-muted-foreground"
                                        title={evaluator.slug}
                                    >
                                        {evaluator.slug}
                                    </span>
                                </span>
                            </AccordionTrigger>
                            <AccordionContent className="[&>div]:px-3 [&>div]:py-3">
                                <AnnotationEvaluatorSection
                                    slug={evaluator.slug}
                                    fields={metrics[evaluator.slug] ?? {}}
                                    readOnly={readOnly}
                                    onChange={updateMetric}
                                />
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </div>
            {showSubmit && !readOnly ? (
                <div className="shrink-0 border-0 border-t border-solid border-border p-3">
                    <LoadingButton
                        className="w-full"
                        loading={submission.isSubmitting}
                        disabled={!submission.canSubmit}
                        onClick={() => void submission.submit()}
                    >
                        {submission.label}
                    </LoadingButton>
                </div>
            ) : null}
        </div>
    )
}
