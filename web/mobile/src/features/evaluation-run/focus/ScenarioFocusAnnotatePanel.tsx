import {useState} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {
    addRunSteps,
    evaluationRunQueryKey,
    humanAnnotationStep,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import obsAnnotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {Alert, Button, LoadingButton} from "@agenta/ui/ui"
import {XIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {
    SUBMIT_FAILURE_TEXT,
    useSubmitAnnotations,
} from "@/features/annotations/useSubmitAnnotations"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {ScenarioFocusAnnotateClosedRun} from "./ScenarioFocusAnnotateClosedRun"
import {ScenarioFocusAnnotateEvaluators, useRunHumanSteps} from "./ScenarioFocusAnnotateEvaluators"
import {ScenarioFocusAnnotateReviews} from "./ScenarioFocusAnnotateReviews"
import {ScenarioFocusAnnotateTestcase} from "./ScenarioFocusAnnotateTestcase"
import {ScenarioFocusSkeleton} from "./states/ScenarioFocusSkeleton"
import {useJudgeReviewDrafts, type JudgeReview, type ScenarioJudge} from "./useJudgeReviews"
import {useRunAnnotationSession} from "./useRunAnnotationSession"
import type {TestcaseDraft} from "./useTestcaseDraft"

/** The toast of a save, the same words the annotation form's own save shows. */
const SAVED_TEXT = "Annotations saved successfully"

/**
 * The Annotate panel beside the test case drawer: "Annotations" (human evaluators), "Evaluator
 * results" (reviews of the automatic evaluators) and "Test case" (changes to the test case, when
 * the run has a test set revision and the user may edit test sets). The panel's Save stores the
 * annotations and the reviews; the test case part has its own "Save to test set". A page must
 * load this file with `next/dynamic`: it brings the annotation controllers.
 */
export const ScenarioFocusAnnotatePanel = ({
    runId,
    header,
    row,
    judges,
    ownReviews,
    focusJudge,
    testset,
    draft,
    expectedKey,
    canEditRun,
    canEditTestsets,
    onClose,
}: {
    runId: string
    header: RunHeader
    row: ScenarioRow
    judges: readonly ScenarioJudge[]
    ownReviews: ReadonlyMap<string, JudgeReview>
    focusJudge: string | null
    /** The run's test set with its name and version; null for a run on traces. */
    testset: {
        testsetId: string
        revisionId: string | null
        name: string
        version: number | null
    } | null
    draft: TestcaseDraft
    expectedKey: string | null
    canEditRun: boolean
    canEditTestsets: boolean
    onClose: () => void
}) => {
    const t = useT(annotateCatalog, obsAnnotateCatalog)
    const scenarioId = row.scenario.id
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const store = useStore()
    const queryClient = useQueryClient()
    const {isOpen, onSaved} = useRunAnnotationSession(runId)
    const run = useRunHumanSteps(runId)
    const submission = useSubmitAnnotations(scenarioId, {runId}, onSaved)
    const formChanges = useAtomValue(
        annotationFormController.selectors.pendingChangeCount(scenarioId),
    )
    const clearSubmitError = useSetAtom(annotationFormController.actions.clearSubmitError)
    const formEvaluators = useAtomValue(annotationSessionController.selectors.formEvaluators())
    const setFormEvaluators = useSetAtom(annotationSessionController.actions.setFormEvaluators)
    const reviews = useJudgeReviewDrafts({
        judges,
        own: ownReviews,
        testset,
        testcaseId: row.testcaseId,
    })
    const [saving, setSaving] = useState(false)
    const [failed, setFailed] = useState(false)

    const closed = header.flags.isClosed
    const readOnly = closed
    const changes = formChanges + reviews.changedCount

    /** Adds the evaluators picked here that the run does not have yet, then reads the run again. */
    const addPickedSteps = async () => {
        const inRun = new Set(run.slugs)
        const picked = (formEvaluators?.added ?? []).filter(
            (ref) => ref.slug && !inRun.has(ref.slug),
        )
        if (picked.length === 0) return
        if (!run.inputKey || !run.invocationKey) throw new Error("The run has no app step")
        const steps = picked.map((ref) => {
            const revision = ref.workflowId
                ? store.get(workflowLatestRevisionQueryAtomFamily(ref.workflowId)).data
                : null
            if (!revision?.id || !ref.slug) throw new Error(`No revision of ${ref.slug}`)
            return humanAnnotationStep(
                {
                    revisionId: revision.id,
                    workflowId: ref.workflowId,
                    variantId: revision.workflow_variant_id ?? null,
                    slug: ref.slug,
                },
                run.inputKey as string,
                run.invocationKey as string,
            )
        })
        await addRunSteps({projectId, runId, steps})
        await queryClient.refetchQueries({queryKey: evaluationRunQueryKey(runId)})
        setFormEvaluators({added: [], hidden: formEvaluators?.hidden ?? []})
    }

    const save = async () => {
        if (saving) return
        setSaving(true)
        setFailed(false)
        try {
            await addPickedSteps()
            const formSaved = formChanges > 0
            if (formSaved) {
                // The form's save reports its own failure and its own success toast.
                await submission.submit()
                if (store.get(annotationFormController.selectors.submitError(scenarioId))) {
                    clearSubmitError(scenarioId)
                    throw new Error("The annotations were not saved")
                }
            }
            if (reviews.changedCount > 0) {
                await reviews.save()
                if (!formSaved) message.success(SAVED_TEXT)
            }
        } catch (cause) {
            console.error("Saving the annotations failed", cause)
            setFailed(true)
        } finally {
            setSaving(false)
        }
    }

    const saveTestcase = async () => {
        try {
            await draft.save()
        } catch (cause) {
            console.error("Saving the test case to the test set failed", cause)
            message.error(t("evaluations.scenarioFocusAnnotate.saveToTestsetFailed"))
        }
    }

    return (
        <aside
            aria-label={t("observability.annotate.annotate")}
            className="flex min-h-0 w-full shrink-0 flex-col border-0 border-solid border-border lg:w-95 lg:border-l"
        >
            <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-border px-4 py-3">
                <h2 className="m-0 text-title">{t("observability.annotate.annotate")}</h2>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("evaluations.scenarioFocusAnnotate.closeAnnotations")}
                    title={t("evaluations.scenarioFocusAnnotate.closeAnnotations")}
                    onClick={onClose}
                >
                    <XIcon />
                </Button>
            </div>
            {closed ? (
                <ScenarioFocusAnnotateClosedRun runId={runId} canReopen={canEditRun} />
            ) : null}
            {failed ? (
                <Alert
                    banner
                    type="error"
                    showIcon
                    message={SUBMIT_FAILURE_TEXT}
                    action={
                        <Button variant="outline" size="sm" onClick={() => void save()}>
                            {t("observability.annotate.tryAgain")}
                        </Button>
                    }
                />
            ) : null}
            {isOpen ? (
                <div inert={saving} className="min-h-0 flex-1 overflow-y-auto">
                    <ScenarioFocusAnnotateEvaluators
                        runId={runId}
                        scenarioId={scenarioId}
                        hasOutput={Boolean(row.invocation?.traceId)}
                        readOnly={readOnly}
                        canEditRun={canEditRun}
                    />
                    <ScenarioFocusAnnotateReviews
                        judges={judges}
                        draftFor={reviews.draftFor}
                        onDraft={reviews.setDraft}
                        focusJudge={focusJudge}
                        readOnly={readOnly}
                    />
                    {testset && canEditTestsets ? (
                        <ScenarioFocusAnnotateTestcase
                            draft={draft}
                            testsetName={testset.name}
                            version={testset.version}
                            expectedKey={expectedKey}
                            onSave={() => void saveTestcase()}
                        />
                    ) : null}
                </div>
            ) : (
                <div className="min-h-0 flex-1 p-4">
                    <ScenarioFocusSkeleton />
                </div>
            )}
            {readOnly ? null : (
                <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-border px-4 py-3">
                    <span className="text-meta text-muted-foreground">
                        {changes > 0
                            ? t("evaluations.scenarioFocusAnnotate.changeCount", {count: changes})
                            : null}
                    </span>
                    <LoadingButton
                        loading={saving}
                        disabled={changes === 0}
                        onClick={() => void save()}
                    >
                        {t("observability.annotate.save")}
                    </LoadingButton>
                </div>
            )}
        </aside>
    )
}

export default ScenarioFocusAnnotatePanel
