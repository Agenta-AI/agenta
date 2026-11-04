import type {FormEvent} from "react"

import {parseWorkflowKeyFromUri} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {
    Button,
    Field,
    Input,
    LoadingButton,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Textarea,
} from "@agenta/ui/ui"

import {LiveEvaluatorSection} from "./LiveEvaluatorSection"
import {LiveSection} from "./LiveSection"
import {LiveTraceFilter} from "./LiveTraceFilter"
import {SamplingRateControl} from "./SamplingRateControl"
import type {CreateLiveEvaluationResult} from "./useCreateLiveEvaluation"
import {useLiveEvaluationForm, type LiveEvaluationDraft} from "./useLiveEvaluationForm"
import {useLiveEvaluators} from "./useLiveEvaluators"

const querySummary = (filterCount: number, samplingRate: number | null) =>
    [
        filterCount === 0 ? "No filters" : `${filterCount} filter${filterCount === 1 ? "" : "s"}`,
        samplingRate === null ? null : `Sampling ${samplingRate}%`,
        "Live traffic",
    ]
        .filter(Boolean)
        .join(" • ")

/**
 * The live evaluation form inside the sheet. The sheet mounts it only while open, so each open
 * starts empty. A failed create keeps the input.
 */
export const LiveEvaluationForm = ({
    evaluatorsHref,
    isCreating,
    create,
    onClose,
    onCreated,
    initial,
}: {
    /** Where "Open evaluator registry" goes. Null while the evaluators view is off. */
    evaluatorsHref: string | null
    isCreating: boolean
    create: (
        draft: LiveEvaluationDraft,
        evaluatorRevisionId: string,
    ) => Promise<CreateLiveEvaluationResult>
    onClose: () => void
    onCreated: () => void
    /** Starting values over the empty form, for a story or a test. The sheet passes none. */
    initial?: Partial<LiveEvaluationDraft>
}) => {
    const {draft, update, pickEvaluator, validate, errors} = useLiveEvaluationForm(initial)
    const evaluators = useLiveEvaluators()
    const picked = evaluators.evaluators.find((e) => e.id === draft.evaluatorRevisionId)

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        if (isCreating || !validate() || !draft.evaluatorRevisionId) return
        const result = await create(draft, draft.evaluatorRevisionId)
        if (result === "created") {
            onCreated()
            onClose()
        }
    }

    return (
        <form
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            aria-label="Live evaluation"
            className="flex min-h-0 flex-1 flex-col"
        >
            <SheetHeader showCloseButton={!isCreating}>
                <SheetTitle>Live evaluation</SheetTitle>
                <SheetDescription className="sr-only">
                    Name the evaluation, choose the traces to evaluate, then pick an evaluator.
                </SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                <LiveSection title="General">
                    <Field label="Name" required error={errors.name}>
                        <Input
                            autoFocus
                            name="name"
                            value={draft.name}
                            placeholder="Testing evaluator"
                            disabled={isCreating}
                            aria-invalid={Boolean(errors.name)}
                            onChange={(event) => update({name: event.target.value})}
                        />
                    </Field>
                    <Field label="Description">
                        <Textarea
                            name="description"
                            value={draft.description}
                            placeholder="Describe this evaluation"
                            disabled={isCreating}
                            rows={3}
                            onChange={(event) => update({description: event.target.value})}
                        />
                    </Field>
                </LiveSection>
                <LiveSection
                    title="Query"
                    summary={querySummary(draft.userFilters.length, draft.samplingRate)}
                >
                    <Field label="Run for filters">
                        <div>
                            <LiveTraceFilter
                                userFilters={draft.userFilters}
                                disabled={isCreating}
                                onChange={(userFilters) => update({userFilters})}
                            />
                        </div>
                    </Field>
                    <Field label="Sampling rate">
                        <SamplingRateControl
                            value={draft.samplingRate}
                            disabled={isCreating}
                            onChange={(samplingRate) => update({samplingRate})}
                        />
                    </Field>
                </LiveSection>
                <LiveSection
                    title="Evaluator"
                    summary={
                        picked ? (
                            <>
                                <span className="truncate">{picked.name}</span>
                                <WorkflowTypeTag
                                    isEvaluator
                                    workflowKey={parseWorkflowKeyFromUri(picked.data?.uri)}
                                />
                            </>
                        ) : null
                    }
                >
                    <LiveEvaluatorSection
                        list={evaluators}
                        picked={picked}
                        error={errors.evaluator}
                        disabled={isCreating}
                        evaluatorsHref={evaluatorsHref}
                        onPick={(evaluator) =>
                            pickEvaluator(evaluator.id, evaluator.name ?? evaluator.slug ?? "")
                        }
                    />
                </LiveSection>
            </div>
            <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" disabled={isCreating} onClick={onClose}>
                    Cancel
                </Button>
                <LoadingButton
                    type="submit"
                    loading={isCreating}
                    disabled={isCreating || evaluators.noneSupported}
                >
                    Create live evaluation
                </LoadingButton>
            </SheetFooter>
        </form>
    )
}
