import {useMemo, useState} from "react"

import {annotationSessionController, type EvaluatorStepRef} from "@agenta/annotation"
import {
    annotationStepSlug,
    evaluationRunMolecule,
    evaluationRunQueryAtomFamily,
} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import obsAnnotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Button} from "@agenta/ui/ui"
import {PlusIcon, XIcon} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AnnotationFormPanel} from "@/features/annotations/AnnotationFormPanel"
import {ScenarioMessage} from "@/features/annotations/ScenarioMessage"
import {SelectEvaluatorsStep} from "@/features/observability/annotate/SelectEvaluatorsStep"
import {useEvaluatorsHref} from "@/features/observability/annotate/useEvaluatorsHref"
import {useHumanEvaluators} from "@/features/observability/annotate/useHumanEvaluators"

/** The run's human evaluators by slug, and its input and invocation step keys. */
export function useRunHumanSteps(runId: string) {
    const humanSteps = useAtomValue(evaluationRunMolecule.selectors.humanAnnotationSteps(runId))
    const steps = useAtomValue(evaluationRunQueryAtomFamily(runId)).data?.data?.steps
    return useMemo(
        () => ({
            slugs: humanSteps.flatMap((step) => annotationStepSlug(step) ?? []),
            inputKey: steps?.find((step) => step.type === "input")?.key ?? null,
            invocationKey: steps?.find((step) => step.type === "invocation")?.key ?? null,
        }),
        [humanSteps, steps],
    )
}

/**
 * The "Annotations" part of the Annotate panel: the run's human evaluators and the ones picked
 * here, as the shared annotation form. "Add evaluator" opens the human evaluator picker; a
 * checkbox acts at once (unchecking hides the form, checking again brings its values back). An
 * evaluator the run does not have yet joins the run on Save. Without an app output there is
 * nothing to link an annotation to, so the form does not show.
 */
export const ScenarioFocusAnnotateEvaluators = ({
    runId,
    scenarioId,
    hasOutput,
    readOnly,
    canEditRun,
}: {
    runId: string
    scenarioId: string
    hasOutput: boolean
    readOnly: boolean
    /** `edit_evaluation_runs`: without it the picker lists only the run's evaluators. */
    canEditRun: boolean
}) => {
    const t = useT(annotateCatalog, obsAnnotateCatalog)
    const [picking, setPicking] = useState(false)
    const run = useRunHumanSteps(runId)
    const humanEvaluators = useHumanEvaluators()
    const evaluatorsHref = useEvaluatorsHref()
    const formEvaluators = useAtomValue(annotationSessionController.selectors.formEvaluators())
    const setFormEvaluators = useSetAtom(annotationSessionController.actions.setFormEvaluators)
    // The evaluators the shared form shows: the run's, without the hidden ones, then the added.
    const formRefs = useAtomValue(annotationSessionController.selectors.evaluatorStepRefs())
    const formSlugs = formRefs.flatMap((ref) => ref.slug ?? [])
    const added = formEvaluators?.added ?? []
    const inRun = new Set(run.slugs)
    const listed = canEditRun
        ? humanEvaluators.evaluators
        : humanEvaluators.evaluators.filter((evaluator) => inRun.has(evaluator.slug ?? ""))
    const noteBySlug = Object.fromEntries(
        run.slugs.map((slug) => [slug, t("evaluations.scenarioFocusAnnotate.inThisRun")]),
    )

    const pick = (slugs: string[]) => {
        const picked = new Set(slugs)
        const nextAdded: EvaluatorStepRef[] = slugs.flatMap((slug) => {
            if (inRun.has(slug)) return []
            const kept = added.find((ref) => ref.slug === slug)
            if (kept) return [kept]
            const evaluator = humanEvaluators.evaluators.find((item) => item.slug === slug)
            return evaluator
                ? [
                      {
                          workflowId: evaluator.id,
                          slug,
                          stepKey: run.invocationKey ? `${run.invocationKey}.${slug}` : null,
                      },
                  ]
                : []
        })
        setFormEvaluators({
            added: nextAdded,
            hidden: run.slugs.filter((slug) => !picked.has(slug)),
        })
    }
    const remove = (slug: string) => pick(formSlugs.filter((item) => item !== slug))

    let body
    if (!hasOutput) {
        body = <ScenarioMessage title={t("evaluations.scenarioFocusAnnotate.runInvocationFirst")} />
    } else if (formSlugs.length === 0) {
        body = (
            <div className="flex flex-col gap-1 px-4 py-3">
                <span className="text-label">{t("observability.annotate.noAnnotations")}</span>
                <span className="text-body text-muted-foreground">
                    {t("evaluations.scenarioFocusAnnotate.pickHint")}
                </span>
            </div>
        )
    } else {
        body = (
            // The form's own "Annotations" header is this part's header; its first child goes.
            <div className="[&>div>div:first-child]:hidden">
                <AnnotationFormPanel
                    key={scenarioId}
                    runId={runId}
                    scenarioId={scenarioId}
                    readOnly={readOnly}
                    sectionActions={
                        readOnly
                            ? undefined
                            : (slug) => (
                                  <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={t(
                                          "evaluations.scenarioFocusAnnotate.removeFromForm",
                                      )}
                                      title={t("evaluations.scenarioFocusAnnotate.removeFromForm")}
                                      onClick={() => remove(slug)}
                                  >
                                      <XIcon />
                                  </Button>
                              )
                    }
                />
                {added.some((ref) => ref.slug && !inRun.has(ref.slug)) ? (
                    <p className="m-0 px-3 pb-3 text-meta text-muted-foreground">
                        {t("evaluations.scenarioFocusAnnotate.newInRun")}
                    </p>
                ) : null}
            </div>
        )
    }

    return (
        <section
            aria-label={t("evaluations.scenarioFocusAnnotate.annotations")}
            className="flex flex-col border-0 border-b border-solid border-border"
        >
            <div className="flex items-center justify-between gap-2 bg-muted px-3 py-2">
                <h3 className="m-0 flex items-baseline gap-2 text-label">
                    {t("evaluations.scenarioFocusAnnotate.annotations")}
                    {formSlugs.length > 0 ? (
                        <span className="text-meta font-normal text-muted-foreground">
                            {t("evaluations.scenarioFocusAnnotate.humanEvaluatorCount", {
                                count: formSlugs.length,
                            })}
                        </span>
                    ) : null}
                </h3>
                {hasOutput && !readOnly ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={picking}
                        onClick={() => setPicking((open) => !open)}
                    >
                        <PlusIcon aria-hidden />
                        {t("observability.annotate.addEvaluator")}
                    </Button>
                ) : null}
            </div>
            {picking && hasOutput && !readOnly ? (
                <div className="m-3 rounded-lg border border-solid border-border p-2">
                    <SelectEvaluatorsStep
                        evaluators={listed}
                        isLoading={humanEvaluators.isLoading}
                        loadFailed={humanEvaluators.isError}
                        onRetry={humanEvaluators.retry}
                        selected={formSlugs}
                        lockedSlugs={[]}
                        onChange={pick}
                        evaluatorsHref={evaluatorsHref}
                        noteBySlug={noteBySlug}
                    />
                </div>
            ) : null}
            {body}
        </section>
    )
}
