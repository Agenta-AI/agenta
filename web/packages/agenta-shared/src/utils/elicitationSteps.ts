/**
 * The question form as an ordered list of STEPS — the model behind the docked elicitation card.
 *
 * `parseElicitationPayload` (./elicitation) answers "is this payload renderable at all"; this module
 * answers "what does the user see, one question at a time". The split matters: parse owns the wire
 * contract and may reject, and everything here is TOTAL over what parse accepts. `buildElicitationSteps`
 * never throws and never reports "unrenderable" — `errorText` stays reserved for a parse failure, so a
 * field shape this version doesn't render yet DEGRADES to a plain control instead of killing the run.
 *
 * It lives in this leaf package because both halves of the UI need it and neither may import the
 * other: the docked card is in @agenta/chat, the transcript marker that replays settled answers is
 * in @agenta/entity-ui, and entity-ui → chat is the workspace cycle the client-tool contract exists
 * to prevent (see ./clientTools).
 */
import dayjs from "./dayjs"
import {
    normalizeStringFormat,
    type ElicitationFieldSchema,
    type ElicitationRequestPayload,
} from "./elicitation"

/**
 * What the card renders for one question.
 *
 * `multiselect` is a real control: an array whose items carry an enum, rendered as toggle rows.
 * `list` is a chip field, and `date`/`date-time` are real pickers. `unsupported` is the only DEGRADE
 * lane left — see `buildElicitationSteps`.
 */
export type ElicitationStepKind =
    | "text"
    | "multiline"
    | "number"
    | "enum"
    | "boolean"
    | "multiselect"
    | "list"
    | "date"
    | "date-time"
    | "unsupported"

export interface ElicitationStepOption {
    value: string
    label: string
    /** `oneOf` explanation, revealed by the row's `?` affordance. */
    description?: string
}

export interface ElicitationStep {
    /** Schema property name — the key this answer is sent under. */
    name: string
    label: string
    kind: ElicitationStepKind
    required: boolean
    /** Sub-label under the question: the schema `description`, or a degrade hint like `YYYY-MM-DD`. */
    hint?: string
    options?: ElicitationStepOption[]
    /** Enum steps carry a trailing "Other" row: the dialect treats options as suggestions. */
    allowOther: boolean
    integer: boolean
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    default?: unknown
    /** A `text` step whose value has a checkable shape. Drives `validateStep`, not the control. */
    format?: "email" | "uri"
    /**
     * Set when the wire asked for something richer than this version renders. The step still works —
     * this only records WHAT was flattened, so a follow-up can find every degrade site and so the
     * hint copy has something to key on. Cron is the last one: everything else grew a real control.
     */
    degraded?: "cron"
}

export interface ElicitationForm {
    message: string
    steps: ElicitationStep[]
    /**
     * `x-ag-stepper` off the schema. Carried, never read: the card always pages one question at a
     * time, and this is reserved for the future "group up to three short questions" mode.
     */
    groupHint: boolean
}

/** Hint copy for a shape the field itself can't show, so the user still knows what to type. */
const CRON_HINT = "5 fields, e.g. 0 9 * * 1-5"
const FORMAT_HINTS: Record<NonNullable<ElicitationStep["format"]>, string> = {
    email: "you@example.com",
    uri: "https://…",
}

const titleOf = (name: string, field: ElicitationFieldSchema): string => field.title?.trim() || name

/**
 * Options for an enum step. Parse already mirrored `oneOf` consts into `enum`, so `enum` is the
 * source of truth for VALUES and `oneOf` only contributes labels and descriptions.
 */
const optionsOf = (field: ElicitationFieldSchema): ElicitationStepOption[] | undefined => {
    const values = field.enum ?? field.items?.enum
    if (!values?.length) return undefined
    const meta = new Map(
        (field.oneOf ?? field.items?.oneOf ?? []).map((option) => [option.const, option]),
    )
    return values.map((value) => {
        const option = meta.get(value)
        return {
            value,
            label: option?.title?.trim() || value,
            ...(option?.description ? {description: option.description} : {}),
        }
    })
}

/**
 * A nested quantifier — `(a+)+`, `(a*)*`, `(a+)*` — is the classic catastrophic-backtracking shape,
 * and `pattern` reaches us from a schema the MODEL wrote. Rather than hand `RegExp.test` something
 * that can pin the browser thread on a crafted answer, screen those out and let the value through
 * unchecked: an unenforced constraint the agent can re-ask about beats a frozen tab.
 */
const isCatastrophicPattern = (pattern: string): boolean =>
    /\((?:[^()]*[+*])\)[+*]/.test(pattern) || /\([^()]*\{\d+,\}?\}[^()]*\)[+*]/.test(pattern)

/** Numeric hint from the schema bounds, so the design's `1–90 days` reads true. */
const rangeHint = (field: ElicitationFieldSchema): string | undefined => {
    const {minimum: min, maximum: max} = field
    if (min !== undefined && max !== undefined) return `${min}–${max}`
    if (min !== undefined) return `${min} or more`
    if (max !== undefined) return `${max} or less`
    return undefined
}

const buildStep = (
    name: string,
    field: ElicitationFieldSchema,
    required: boolean,
): ElicitationStep => {
    const options = optionsOf(field)
    const format = normalizeStringFormat(field.format)
    const base = {
        name,
        label: titleOf(name, field),
        required,
        allowOther: false,
        integer: field.type === "integer",
        ...(field.minimum !== undefined ? {minimum: field.minimum} : {}),
        ...(field.maximum !== undefined ? {maximum: field.maximum} : {}),
        ...(field.minLength !== undefined ? {minLength: field.minLength} : {}),
        ...(field.maxLength !== undefined ? {maxLength: field.maxLength} : {}),
        ...(field.pattern !== undefined ? {pattern: field.pattern} : {}),
        ...(field.default !== undefined ? {default: field.default} : {}),
    }
    // A fallback hint replaces the schema description only when there is no description: the
    // author's own words beat a generic format reminder.
    const withHint = (
        step: Omit<ElicitationStep, "kind" | "hint">,
        kind: ElicitationStepKind,
        fallbackHint?: string,
    ): ElicitationStep => {
        const hint = field.description?.trim() || fallbackHint
        return {...step, kind, ...(hint ? {hint} : {})}
    }

    // The dialect's only array shape is string items. With an enum there is something to offer as
    // toggle rows; without one there is nothing to list, so entries are collected as chips.
    if (field.type === "array") {
        if (options?.length) {
            return {...withHint(base, "multiselect", "pick any"), options, allowOther: true}
        }
        return withHint(base, "list", "one per entry")
    }

    if (field.type === "boolean") return withHint(base, "boolean")

    if (field.type === "number" || field.type === "integer") {
        return withHint(base, "number", rangeHint(field))
    }

    if (options?.length) {
        // Options are SUGGESTIONS in this dialect, never a hard constraint — every enum keeps an
        // escape hatch.
        return {...withHint(base, "enum"), options, allowOther: true}
    }

    if (format === "multiline") return withHint(base, "multiline")
    if (format === "date" || format === "date-time") return withHint(base, format)
    if (format === "cron") return {...withHint(base, "text", CRON_HINT), degraded: "cron"}
    if (format === "email" || format === "uri")
        return {...withHint(base, "text", FORMAT_HINTS[format]), format}

    if (field.type === "string") return withHint(base, "text")

    // Unreachable against what parse admits. It exists so a widened dialect degrades rather than
    // crashing: never required, never serialized.
    return withHint({...base, required: false}, "unsupported")
}

/**
 * The payload's questions, in the order the agent wrote them.
 *
 * Deliberately NOT reordered (required first, say): the agent authored these as a narrative, and
 * reordering would also desynchronise the review rows from the message above them.
 */
export function buildElicitationSteps(payload: ElicitationRequestPayload): ElicitationForm {
    const required = new Set(payload.requestedSchema.required ?? [])
    return {
        message: payload.message,
        steps: Object.entries(payload.requestedSchema.properties).map(([name, field]) =>
            buildStep(name, field, required.has(name)),
        ),
        groupHint: payload.requestedSchema["x-ag-stepper"] === true,
    }
}

/** Values a step contributes before the user touches anything. */
export function initialStepValues(steps: ElicitationStep[]): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    for (const step of steps) {
        if (step.kind === "unsupported" || step.default === undefined) continue
        values[step.name] = step.default
    }
    return values
}

/** Whether this step has an answer worth sending. `false` counts — only absence doesn't. */
export function isStepAnswered(step: ElicitationStep, value: unknown): boolean {
    if (step.kind === "unsupported") return false
    if (step.kind === "boolean") return typeof value === "boolean"
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "number") return Number.isFinite(value)
    return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null
}

/**
 * The blocking problem with this answer, or null.
 *
 * Beyond `required` this enforces the bounds the dialect already carries (`minimum`/`maximum`,
 * `minLength`/`maxLength`, `pattern`) — NEW behaviour, not a port: the old `SchemaForm` built its
 * rules as `required ? [{required: true}] : []` and dropped the rest on the floor.
 */
export function validateStep(step: ElicitationStep, value: unknown): string | null {
    if (!isStepAnswered(step, value)) {
        if (!step.required) return null
        return step.kind === "enum" ? "Pick one to continue" : "This one is required"
    }

    if (step.kind === "number" && typeof value === "number") {
        if (step.integer && !Number.isInteger(value)) return "Whole numbers only"
        if (step.minimum !== undefined && value < step.minimum)
            return `Must be ${step.minimum} or more`
        if (step.maximum !== undefined && value > step.maximum)
            return `Must be ${step.maximum} or less`
    }

    if (typeof value === "string") {
        const text = value.trim()
        // Format checks the dialect implies but never enforced. Cron is deliberately absent: a
        // valid-but-odd expression is a scheduling decision for the agent, not a typo to reject.
        if (step.kind === "date" || step.kind === "date-time") {
            if (!dayjs(text).isValid()) return "That isn't a real date"
        }
        if (step.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
            return "Needs a valid email address"
        if (step.format === "uri") {
            try {
                new URL(text)
            } catch {
                return "Needs a full URL, including the scheme"
            }
        }
        if (step.minLength !== undefined && text.length < step.minLength)
            return `At least ${step.minLength} characters`
        if (step.maxLength !== undefined && text.length > step.maxLength)
            return `At most ${step.maxLength} characters`
        if (step.pattern !== undefined && !isCatastrophicPattern(step.pattern)) {
            try {
                if (!new RegExp(step.pattern).test(text))
                    return "That doesn't match the expected format"
            } catch {
                // An author's bad regex must not block an otherwise fine answer.
            }
        }
    }

    return null
}

/** Turn what the control holds into what goes on the wire. Only `list` needs converting: a
 * multiselect already holds its `string[]`. */
export function parseStepValue(step: ElicitationStep, raw: unknown): unknown {
    if (step.kind !== "list") return raw
    if (Array.isArray(raw)) return raw
    if (typeof raw !== "string") return undefined
    const items = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    return items.length ? items : undefined
}

/** One answer as the review rows and the settled transcript summary print it. */
export function formatStepValue(step: ElicitationStep, value: unknown): string {
    if (!isStepAnswered(step, value)) return "Skipped"
    if (step.kind === "boolean") return value ? "Yes" : "No"
    if (step.kind === "date" || step.kind === "date-time") {
        const when = dayjs(String(value))
        if (when.isValid())
            return when.format(step.kind === "date" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm")
    }
    const parsed = parseStepValue(step, value)
    if (Array.isArray(parsed)) return parsed.join(", ")
    if (step.kind === "enum") {
        const option = step.options?.find((candidate) => candidate.value === parsed)
        if (option) return option.label
    }
    return String(parsed)
}

/** Answered values, keyed by property name — what `accept` sends. Skipped keys are absent. */
export function collectStepContent(
    steps: ElicitationStep[],
    values: Record<string, unknown>,
): Record<string, unknown> {
    const content: Record<string, unknown> = {}
    for (const step of steps) {
        const value = values[step.name]
        if (!isStepAnswered(step, value)) continue
        const parsed = parseStepValue(step, value)
        if (parsed === undefined) continue
        content[step.name] = parsed
    }
    return content
}

/**
 * The property name behind a secret-shaped rejection, for the refusal panel's copy. Keyed to the
 * reason string `parseElicitationPayload` builds; null for every other rejection.
 */
export function parseSecretRefusal(reason: string): {property: string} | null {
    const match = /^property "(.+?)" is secret-shaped/.exec(reason)
    return match ? {property: match[1]} : null
}
