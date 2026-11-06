import {useMemo, useRef, useState, type FormEvent} from "react"

import {Alert, Button, Field, Input, LoadingButton, SheetFooter, Textarea} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {FeedbackFieldCard} from "./FeedbackFieldCard"
import {
    draftSignature,
    emptyFeedbackField,
    slugFromName,
    validateHumanEvaluator,
    type HumanEvaluatorDraft,
} from "./humanEvaluatorForm"

/** The human evaluator create and edit form; in edit mode the name and slug stay fixed. */
export const HumanEvaluatorForm = ({
    initial,
    mode,
    saving,
    serverError,
    onSubmit,
    onCancel,
    onEdit,
}: {
    initial: HumanEvaluatorDraft
    mode: "create" | "edit"
    saving: boolean
    /** The last save's failure; `field: "slug"` puts it under the slug. */
    serverError: {field?: "slug"; message: string} | null
    onSubmit: (draft: HumanEvaluatorDraft) => void
    onCancel: () => void
    /** The reader changed the form: a shown save error is stale now. */
    onEdit: () => void
}) => {
    const [draft, setDraftState] = useState(initial)
    const setDraft = (update: (current: HumanEvaluatorDraft) => HumanEvaluatorDraft) => {
        if (serverError) onEdit()
        setDraftState(update)
    }
    const [slugTouched, setSlugTouched] = useState(mode === "edit")
    const [submitted, setSubmitted] = useState(false)
    const bodyRef = useRef<HTMLDivElement>(null)
    const editing = mode === "edit"
    const initialSignature = useMemo(() => draftSignature(initial), [initial])
    const changed = draftSignature(draft) !== initialSignature

    const errors = submitted ? validateHumanEvaluator(draft, mode) : {}
    if (serverError?.field === "slug" && !errors.slug) errors.slug = serverError.message

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (saving) return
        setSubmitted(true)
        if (Object.keys(validateHumanEvaluator(draft, mode)).length > 0) {
            // The first error may sit below the fold.
            requestAnimationFrame(() =>
                bodyRef.current
                    ?.querySelector("[aria-invalid=true]")
                    ?.scrollIntoView({block: "center"}),
            )
            return
        }
        onSubmit(draft)
    }

    const addField = () => {
        setDraft((current) => ({...current, fields: [...current.fields, emptyFeedbackField()]}))
        requestAnimationFrame(() =>
            bodyRef.current?.scrollTo({top: bodyRef.current.scrollHeight, behavior: "smooth"}),
        )
    }

    return (
        <form
            noValidate
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
            aria-label={editing ? "Edit evaluator" : "Create evaluator"}
        >
            <div
                ref={bodyRef}
                className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4"
            >
                {serverError && serverError.field !== "slug" ? (
                    <Alert type="error" showIcon message={serverError.message} />
                ) : null}
                <section className="flex flex-col gap-4">
                    <Field label="Evaluator name" required error={errors.name}>
                        <Input
                            value={draft.name}
                            placeholder="For example Answer quality"
                            disabled={saving || editing}
                            onChange={(event) => {
                                const name = event.target.value
                                setDraft((current) => ({
                                    ...current,
                                    name,
                                    slug: slugTouched ? current.slug : slugFromName(name),
                                }))
                            }}
                        />
                    </Field>
                    <Field
                        label="Evaluator slug"
                        required
                        description={
                            editing ? undefined : "Used to refer to the evaluator in code."
                        }
                        error={errors.slug}
                    >
                        <Input
                            value={draft.slug}
                            placeholder="answer-quality"
                            disabled={saving || editing}
                            onChange={(event) => {
                                setSlugTouched(true)
                                setDraft((current) => ({...current, slug: event.target.value}))
                            }}
                        />
                    </Field>
                    <Field label="Description">
                        <Textarea
                            rows={2}
                            value={draft.description}
                            placeholder="What reviewers should judge"
                            disabled={saving}
                            onChange={(event) =>
                                setDraft((current) => ({
                                    ...current,
                                    description: event.target.value,
                                }))
                            }
                        />
                    </Field>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="flex flex-col gap-0.5">
                        <h3 className="m-0 text-sm font-semibold text-foreground">Feedback</h3>
                        <p className="m-0 text-[13px] text-muted-foreground">
                            What a reviewer fills in for each item.
                        </p>
                    </div>
                    {draft.fields.map((field, index) => (
                        <FeedbackFieldCard
                            key={field.key}
                            field={field}
                            index={index}
                            errors={errors}
                            removable={draft.fields.length > 1}
                            disabled={saving}
                            onChange={(next) =>
                                setDraft((current) => ({
                                    ...current,
                                    fields: current.fields.map((item) =>
                                        item.key === field.key ? next : item,
                                    ),
                                }))
                            }
                            onRemove={() =>
                                setDraft((current) => ({
                                    ...current,
                                    fields: current.fields.filter((item) => item.key !== field.key),
                                }))
                            }
                        />
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        disabled={saving}
                        onClick={addField}
                    >
                        <Plus aria-hidden />
                        Add feedback
                    </Button>
                </section>
            </div>

            <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
                    Cancel
                </Button>
                <LoadingButton type="submit" loading={saving} disabled={editing && !changed}>
                    {editing ? "Update" : "Create"}
                </LoadingButton>
            </SheetFooter>
        </form>
    )
}
