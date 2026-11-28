import {useEffect, useMemo, useState, type ReactNode} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Alert,
    LoadingButton,
    cn,
} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotationEvaluatorSection} from "./AnnotationEvaluatorSection"
import {AnnotationPanelHeader} from "./AnnotationPanelHeader"
import {useAnnotationFormState} from "./useAnnotationFormState"
import {
    SUBMIT_FAILURE_TEXT,
    useSubmitAnnotations,
    type OnAnnotationsSaved,
} from "./useSubmitAnnotations"

const PanelMessage = ({children, action}: {children: string; action?: ReactNode}) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-body text-muted-foreground">
        {children}
        {action}
    </div>
)

/** The form belongs to a queue's item, or to a scenario of an evaluation run. */
type FormScope = {queueId: string; runId?: never} | {runId: string; queueId?: never}

/**
 * The form for one scenario: one open section per evaluator (its name, its description, a line
 * between sections, the field count when folded), its metrics as fields. With `showSubmit` (the
 * annotate sheets, the run's Annotate tab) it carries its own submit button; the queue's Annotate
 * tab draws its own under the form. `readOnly` shows the values without the button.
 * `sectionActions` draws the host's controls at the end of each evaluator header. The queue adds
 * `fieldKeys` (keys and focus on each field), a `notice` under the header, and `emptyAction`
 * beside "No evaluators configured for this queue".
 */
export const AnnotationFormPanel = ({
    scenarioId,
    showSubmit = false,
    readOnly = false,
    onSaved,
    sectionActions,
    fieldKeys = false,
    notice,
    emptyAction,
    ...scope
}: FormScope & {
    scenarioId: string
    showSubmit?: boolean
    readOnly?: boolean
    onSaved?: OnAnnotationsSaved
    /** At the end of each evaluator header, outside its toggle: the host's actions. */
    sectionActions?: (slug: string) => ReactNode
    fieldKeys?: boolean
    notice?: ReactNode
    emptyAction?: ReactNode
}) => {
    const t = useT(queueScreensCatalog)
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
    const noEvaluators = stepRefs.length === 0
    const nothingLoaded = !noEvaluators && evaluators.length === 0
    const panelMessage = noEvaluators
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
                {notice}
                <PanelMessage action={noEvaluators ? emptyAction : undefined}>
                    {panelMessage}
                </PanelMessage>
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {header}
            {notice}
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
            <div className="min-h-0 flex-1 overflow-y-auto" data-annotation-fields>
                <Accordion type="multiple" variant="ghost" value={open} onValueChange={setOpen}>
                    {sections.map((evaluator) => {
                        const name = evaluator.name || evaluator.slug
                        const fieldCount = Object.keys(metrics[evaluator.slug] ?? {}).length
                        const isOpen = open.includes(evaluator.slug)
                        return (
                            <AccordionItem
                                key={evaluator.slug}
                                value={evaluator.slug}
                                className={cn(
                                    "border-0 border-b border-solid border-border-muted last:border-b-0",
                                    !isOpen && "pb-3",
                                )}
                            >
                                <div className="flex items-center px-3 pt-3 [&>[data-slot=accordion-header]]:min-w-0 [&>[data-slot=accordion-header]]:flex-1">
                                    <AccordionTrigger className="px-0 py-0 text-label">
                                        <span className="flex min-w-0 items-baseline gap-2">
                                            <span className="min-w-0 truncate" title={name}>
                                                {name}
                                            </span>
                                            {isOpen ? null : (
                                                <span className="shrink-0 text-meta text-muted-foreground">
                                                    {t("annotation.queueScreens.fieldCount", {
                                                        count: fieldCount,
                                                    })}
                                                </span>
                                            )}
                                        </span>
                                    </AccordionTrigger>
                                    {sectionActions ? (
                                        <div className="flex shrink-0 items-center">
                                            {sectionActions(evaluator.slug)}
                                        </div>
                                    ) : null}
                                </div>
                                {evaluator.description ? (
                                    <p className="m-0 px-3 pt-1 text-body-sm text-muted-foreground">
                                        {evaluator.description}
                                    </p>
                                ) : null}
                                <AccordionContent className="[&>div]:px-3 [&>div]:pt-3 [&>div]:pb-4">
                                    <AnnotationEvaluatorSection
                                        slug={evaluator.slug}
                                        fields={metrics[evaluator.slug] ?? {}}
                                        readOnly={readOnly}
                                        fieldKeys={fieldKeys}
                                        onChange={updateMetric}
                                    />
                                </AccordionContent>
                            </AccordionItem>
                        )
                    })}
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
