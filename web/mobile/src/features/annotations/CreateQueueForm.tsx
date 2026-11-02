import {useState, type FormEvent} from "react"

import {
    Field,
    Input,
    LoadingButton,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SheetFooter,
    Textarea,
} from "@agenta/ui/ui"

import {
    validateCreateQueue,
    type CreateQueueValues,
    type QueueKind,
    type SelectedEvaluator,
} from "./createQueueTypes"
import {QueueEvaluatorField} from "./QueueEvaluatorField"

const SectionTitle = ({children}: {children: string}) => (
    <h3 className="m-0 text-sm font-semibold text-foreground">{children}</h3>
)

/**
 * The form of the create sheet. Values live here; errors show after the first submit and then
 * follow each change.
 */
export const CreateQueueForm = ({
    defaultKind,
    kindLocked,
    isSubmitting,
    onSubmit,
    onCancel,
    initial,
}: {
    defaultKind: QueueKind
    kindLocked: boolean
    isSubmitting: boolean
    onSubmit: (values: CreateQueueValues) => void
    onCancel: () => void
    /** Starting values, for a story or a test. The sheet passes none. */
    initial?: {
        name?: string
        description?: string
        evaluators?: SelectedEvaluator[]
        submitted?: boolean
    }
}) => {
    const [name, setName] = useState(initial?.name ?? "")
    const [kind, setKind] = useState<QueueKind>(defaultKind)
    const [description, setDescription] = useState(initial?.description ?? "")
    const [evaluators, setEvaluators] = useState<SelectedEvaluator[]>(initial?.evaluators ?? [])
    const [submitted, setSubmitted] = useState(initial?.submitted ?? false)

    // A selection locks the type to the selection's kind.
    const effectiveKind = kindLocked ? defaultKind : kind
    const values: CreateQueueValues = {name, kind: effectiveKind, description, evaluators}
    const errors = submitted ? validateCreateQueue(values) : {}

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault()
        if (isSubmitting) return
        setSubmitted(true)
        if (Object.keys(validateCreateQueue(values)).length > 0) return
        onSubmit({...values, name: name.trim()})
    }

    return (
        <form
            noValidate
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
            aria-label="Create annotation queue"
        >
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
                <section className="flex flex-col gap-4">
                    <SectionTitle>Basic details</SectionTitle>
                    <Field label="Annotation name" required error={errors.name}>
                        <Input
                            value={name}
                            placeholder="Enter name"
                            disabled={isSubmitting}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    <Field label="Queue type" required error={errors.kind}>
                        <Select
                            value={effectiveKind}
                            onValueChange={(next) => setKind(next as QueueKind)}
                            disabled={kindLocked || isSubmitting}
                        >
                            <SelectTrigger className="w-full" aria-label="Queue type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="traces">Traces</SelectItem>
                                <SelectItem value="testcases">Test cases</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field label="Description">
                        <Textarea
                            rows={2}
                            value={description}
                            placeholder="Enter description or reviewer guidance"
                            disabled={isSubmitting}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                    </Field>
                </section>

                <section className="flex flex-col gap-4">
                    <SectionTitle>Annotation details</SectionTitle>
                    <QueueEvaluatorField
                        selected={evaluators}
                        onChange={setEvaluators}
                        error={errors.evaluators}
                        disabled={isSubmitting}
                    />
                </section>
            </div>

            <SheetFooter className="flex-row justify-end">
                <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
                    Cancel
                </Button>
                <LoadingButton type="submit" loading={isSubmitting}>
                    Create
                </LoadingButton>
            </SheetFooter>
        </form>
    )
}
