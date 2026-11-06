import {
    CHOICE_FEEDBACK_TYPES,
    NUMERIC_FEEDBACK_TYPES,
    humanEvaluatorMetricsFromSchema,
    resolveOutputSchema,
    type EvaluatorEntry,
    type HumanEvaluatorMetric,
} from "@agenta/entities/workflow"
import {connectionSlugify, isSlugInputValid} from "@agenta/shared/utils"

/** One feedback field as the form edits it. Numbers stay text until the save. */
export interface FeedbackFieldDraft {
    /** A local key for React; never sent. */
    key: string
    name: string
    type: string
    optional: boolean
    minimum: string
    maximum: string
    options: string[]
}

export interface HumanEvaluatorDraft {
    name: string
    slug: string
    description: string
    fields: FeedbackFieldDraft[]
}

/** Field errors, keyed by `name`, `slug`, `fields.<i>.<part>` or `fields.<i>.options.<j>`. */
export type HumanEvaluatorErrors = Record<string, string>

let nextKey = 0
const newKey = () => `feedback-${++nextKey}`

export const emptyFeedbackField = (): FeedbackFieldDraft => ({
    key: newKey(),
    name: "",
    type: "",
    optional: false,
    minimum: "",
    maximum: "",
    options: [],
})

export const emptyHumanEvaluatorDraft = (): HumanEvaluatorDraft => ({
    name: "",
    slug: "",
    description: "",
    fields: [emptyFeedbackField()],
})

/** The form filled from a saved evaluator: its name, slug, description and feedback fields. */
export const draftFromEvaluator = ({
    workflow,
    latestRevision,
}: EvaluatorEntry): HumanEvaluatorDraft => {
    const metrics = humanEvaluatorMetricsFromSchema(resolveOutputSchema(latestRevision.data))
    return {
        name: workflow.name ?? "",
        slug: workflow.slug ?? "",
        description: workflow.description ?? "",
        fields:
            metrics.length > 0
                ? metrics.map((metric) => ({
                      key: newKey(),
                      name: metric.name,
                      type: metric.type,
                      optional: metric.optional,
                      minimum: metric.minimum === undefined ? "" : String(metric.minimum),
                      maximum: metric.maximum === undefined ? "" : String(metric.maximum),
                      options: metric.enum ?? [],
                  }))
                : [emptyFeedbackField()],
    }
}

/** The slug a name suggests, until the reader edits the slug. */
export const slugFromName = (name: string): string => connectionSlugify(name)

/** A type change keeps the name and the optional switch, and resets what the old type needed. */
export const withFieldType = (field: FeedbackFieldDraft, type: string): FeedbackFieldDraft => ({
    ...field,
    type,
    minimum: NUMERIC_FEEDBACK_TYPES.includes(type) ? field.minimum : "",
    maximum: NUMERIC_FEEDBACK_TYPES.includes(type) ? field.maximum : "",
    options: CHOICE_FEEDBACK_TYPES.includes(type)
        ? field.options.length > 0
            ? field.options
            : [""]
        : [],
})

const SLUG_RULE = "Use only letters, numbers, underscores and dashes, with no spaces."

const numberError = (value: string, type: string): string | null => {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return "Enter a number."
    if (type === "integer" && !Number.isInteger(parsed)) return "Enter a whole number."
    return null
}

/** Every problem the save would hit, by field. An empty result means the draft can be saved. */
export const validateHumanEvaluator = (draft: HumanEvaluatorDraft): HumanEvaluatorErrors => {
    const errors: HumanEvaluatorErrors = {}
    if (!draft.name.trim()) errors.name = "Enter a name."
    if (!draft.slug.trim()) errors.slug = "Enter a slug."
    else if (!isSlugInputValid(draft.slug.trim())) errors.slug = SLUG_RULE

    const names = draft.fields.map((field) => field.name.trim())
    draft.fields.forEach((field, index) => {
        const at = `fields.${index}`
        const name = names[index]
        if (!name) errors[`${at}.name`] = "Enter a feedback name."
        else if (!isSlugInputValid(name)) errors[`${at}.name`] = SLUG_RULE
        else if (names.indexOf(name) !== index) errors[`${at}.name`] = "This name is already used."
        if (!field.type) errors[`${at}.type`] = "Pick a feedback type."

        if (NUMERIC_FEEDBACK_TYPES.includes(field.type)) {
            const minError = numberError(field.minimum, field.type)
            const maxError = numberError(field.maximum, field.type)
            if (minError) errors[`${at}.minimum`] = minError
            if (maxError) errors[`${at}.maximum`] = maxError
            if (
                !minError &&
                !maxError &&
                field.minimum.trim() &&
                field.maximum.trim() &&
                Number(field.maximum) <= Number(field.minimum)
            ) {
                errors[`${at}.maximum`] = "The maximum must be greater than the minimum."
            }
        }

        if (CHOICE_FEEDBACK_TYPES.includes(field.type)) {
            const options = field.options.map((option) => option.trim())
            if (!options.some(Boolean)) errors[`${at}.options`] = "Add at least one option."
            options.forEach((option, optionIndex) => {
                if (option && options.indexOf(option) !== optionIndex) {
                    errors[`${at}.options.${optionIndex}`] = "This option is already added."
                }
            })
        }
    })
    return errors
}

/** The feedback fields as the save sends them: trimmed, numbers parsed, empty options dropped. */
export const draftToMetrics = (draft: HumanEvaluatorDraft): HumanEvaluatorMetric[] =>
    draft.fields.map((field) => {
        const metric: HumanEvaluatorMetric = {
            name: field.name.trim(),
            type: field.type,
            optional: field.optional,
        }
        if (NUMERIC_FEEDBACK_TYPES.includes(field.type)) {
            if (field.minimum.trim()) metric.minimum = Number(field.minimum)
            if (field.maximum.trim()) metric.maximum = Number(field.maximum)
        }
        if (CHOICE_FEEDBACK_TYPES.includes(field.type)) {
            metric.enum = field.options.map((option) => option.trim()).filter(Boolean)
        }
        return metric
    })

/** The draft without its React keys, to compare an edit with what was loaded. */
export const draftSignature = (draft: HumanEvaluatorDraft): string =>
    JSON.stringify({...draft, fields: draft.fields.map(({key: _key, ...rest}) => rest)})
