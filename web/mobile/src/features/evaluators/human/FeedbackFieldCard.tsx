import {
    CHOICE_FEEDBACK_TYPES,
    HUMAN_FEEDBACK_TYPES,
    NUMERIC_FEEDBACK_TYPES,
} from "@agenta/entities/workflow"
import {
    Button,
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"

import {FeedbackOptionsField} from "./FeedbackOptionsField"
import {
    withFieldType,
    type FeedbackFieldDraft,
    type HumanEvaluatorErrors,
} from "./humanEvaluatorForm"

/**
 * One feedback field: its name and type, then what the type needs (a range for numbers, options
 * for choices), and whether a reviewer may skip it.
 */
export const FeedbackFieldCard = ({
    field,
    index,
    errors,
    removable,
    disabled,
    onChange,
    onRemove,
}: {
    field: FeedbackFieldDraft
    index: number
    errors: HumanEvaluatorErrors
    /** The only field cannot be removed: an evaluator collects at least one feedback. */
    removable: boolean
    disabled: boolean
    onChange: (field: FeedbackFieldDraft) => void
    onRemove: () => void
}) => {
    const at = `fields.${index}`
    const numeric = NUMERIC_FEEDBACK_TYPES.includes(field.type)
    const choice = CHOICE_FEEDBACK_TYPES.includes(field.type)
    const step = field.type === "integer" ? 1 : 0.1
    const optionErrors = Object.fromEntries(
        field.options.flatMap((_, optionIndex) => {
            const message = errors[`${at}.options.${optionIndex}`]
            return message ? [[optionIndex, message]] : []
        }),
    )

    return (
        <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border border-solid border-border bg-colorFillQuaternary p-4">
            <legend className="sr-only">Feedback {index + 1}</legend>
            <div className="flex items-start gap-2">
                <Field
                    label="Feedback name"
                    required
                    error={errors[`${at}.name`]}
                    className="min-w-0 flex-1"
                >
                    <Input
                        value={field.name}
                        placeholder="For example score or comment"
                        disabled={disabled}
                        onChange={(event) => onChange({...field, name: event.target.value})}
                    />
                </Field>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="mt-6"
                    aria-label={`Remove feedback ${field.name || index + 1}`}
                    disabled={disabled || !removable}
                    onClick={onRemove}
                >
                    <Trash aria-hidden />
                </Button>
            </div>
            <Field label="Feedback type" required error={errors[`${at}.type`]}>
                <Select
                    value={field.type || undefined}
                    disabled={disabled}
                    onValueChange={(type) => onChange(withFieldType(field, type))}
                >
                    <SelectTrigger className="w-full" aria-label="Feedback type">
                        <SelectValue placeholder="Pick a type" />
                    </SelectTrigger>
                    <SelectContent>
                        {HUMAN_FEEDBACK_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                                {type.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>
            {numeric ? (
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Minimum" error={errors[`${at}.minimum`]}>
                        <Input
                            type="number"
                            inputMode="decimal"
                            step={step}
                            value={field.minimum}
                            placeholder="No minimum"
                            disabled={disabled}
                            onChange={(event) => onChange({...field, minimum: event.target.value})}
                        />
                    </Field>
                    <Field label="Maximum" error={errors[`${at}.maximum`]}>
                        <Input
                            type="number"
                            inputMode="decimal"
                            step={step}
                            value={field.maximum}
                            placeholder="No maximum"
                            disabled={disabled}
                            onChange={(event) => onChange({...field, maximum: event.target.value})}
                        />
                    </Field>
                </div>
            ) : null}
            {choice ? (
                <FeedbackOptionsField
                    options={field.options}
                    error={errors[`${at}.options`]}
                    optionErrors={optionErrors}
                    disabled={disabled}
                    onChange={(options) => onChange({...field, options})}
                />
            ) : null}
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-foreground">
                <span className="flex flex-col">
                    <span className="font-medium">Optional</span>
                    <span className="text-[13px] text-muted-foreground">
                        A reviewer may leave this feedback empty.
                    </span>
                </span>
                <Switch
                    checked={field.optional}
                    disabled={disabled}
                    onCheckedChange={(optional) => onChange({...field, optional})}
                />
            </label>
        </fieldset>
    )
}
