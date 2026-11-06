import {DEFAULT_EVALUATION_CONCURRENCY} from "@agenta/entities/evaluationRun"

/** The wizard starts an auto run or a human run. Live and SDK runs have their own entries. */
export type NewEvaluationKind = "auto" | "human"

export type NewEvaluationSection =
    | "application"
    | "revision"
    | "testset"
    | "evaluators"
    | "settings"

export interface DraftApp {
    id: string
    name: string
}

export interface DraftRevision {
    id: string
    /** The variant name, as shown in the picker. */
    variantName: string
    version: number
}

export interface DraftTestset {
    revisionId: string
    testsetId: string
    name: string
    version: number
}

export interface DraftEvaluator {
    revisionId: string
    evaluatorId: string
    name: string
    version: number
}

export type ConcurrencyField = "batch_size" | "max_retries" | "retry_delay"

/** `null` is an empty field. It blocks the start. */
export type DraftConcurrency = Record<ConcurrencyField, number | null>

export interface NewEvaluationDraft {
    kind: NewEvaluationKind
    app: DraftApp | null
    revisions: DraftRevision[]
    testset: DraftTestset | null
    evaluators: DraftEvaluator[]
    concurrency: DraftConcurrency
    name: string
    /** The last name the draft generated. The name follows the picks while it equals this. */
    autoName: string
    /** Five base-36 characters, fixed for one open of the sheet. */
    suffix: string
    section: NewEvaluationSection
}

export type NewEvaluationAction =
    | {type: "pickApp"; app: DraftApp}
    | {type: "hydrateApp"; app: DraftApp}
    | {type: "clearApp"}
    | {type: "pickRevision"; revision: DraftRevision}
    | {type: "removeRevision"; revisionId: string}
    | {type: "pickTestset"; testset: DraftTestset}
    | {type: "clearTestset"}
    | {type: "pickEvaluator"; evaluator: DraftEvaluator}
    | {type: "removeEvaluator"; revisionId: string}
    | {type: "clearEvaluators"}
    | {type: "setConcurrency"; field: ConcurrencyField; value: number | null}
    | {type: "resetConcurrency"}
    | {type: "setName"; name: string}
    | {type: "blurName"}
    | {type: "openSection"; section: NewEvaluationSection}

export const CONCURRENCY_FIELDS: readonly {
    field: ConcurrencyField
    label: string
    help: string
}[] = [
    {
        field: "batch_size",
        label: "Batch Size",
        help: "Maximum number of concurrent invocations",
    },
    {
        field: "max_retries",
        label: "Max Retries",
        help: "How many times to retry a failed invocation",
    },
    {
        field: "retry_delay",
        label: "Retry Delay (s)",
        help: "Seconds to wait before retrying a failed invocation",
    },
]

export const defaultConcurrency = (): DraftConcurrency => ({...DEFAULT_EVALUATION_CONCURRENCY})

export const isDefaultConcurrency = (concurrency: DraftConcurrency): boolean =>
    CONCURRENCY_FIELDS.every(
        ({field}) => concurrency[field] === DEFAULT_EVALUATION_CONCURRENCY[field],
    )

/** Five base-36 characters. */
export const makeNameSuffix = (random: () => number = Math.random): string =>
    Array.from({length: 5}, () => Math.floor(random() * 36).toString(36)).join("")

/**
 * The name the draft suggests once it has revisions and a test set:
 * `{variant}-v{version}-{test set}-{suffix}`, or `{n}-variants-{test set}-{suffix}` for several.
 */
export const buildAutoName = (
    revisions: readonly DraftRevision[],
    testset: DraftTestset | null,
    suffix: string,
): string => {
    if (revisions.length === 0 || !testset) return ""
    const head =
        revisions.length === 1
            ? `${revisions[0].variantName}-v${revisions[0].version}`
            : `${revisions.length}-variants`
    return `${head}-${testset.name}-${suffix}`
}

export interface InitialDraftOptions {
    app?: DraftApp | null
    revisions?: DraftRevision[]
    suffix?: string
}

/** The open section at start: Revision for a scoped app, Test set for given revisions. */
export const createInitialDraft = (
    kind: NewEvaluationKind,
    {app = null, revisions = [], suffix = makeNameSuffix()}: InitialDraftOptions = {},
): NewEvaluationDraft => ({
    kind,
    app,
    revisions,
    testset: null,
    evaluators: [],
    concurrency: defaultConcurrency(),
    name: "",
    autoName: "",
    suffix,
    section: revisions.length > 0 ? "testset" : app ? "revision" : "application",
})

/**
 * Apply the auto name after a pick. A typed name is never replaced: only an empty name or the
 * name the draft made last time follows the picks.
 */
const followAutoName = (previous: NewEvaluationDraft, next: NewEvaluationDraft) => {
    const autoName = buildAutoName(next.revisions, next.testset, next.suffix)
    const follows = previous.name === "" || previous.name === previous.autoName
    return {...next, autoName, name: follows ? autoName : previous.name}
}

/**
 * Whether the reader put anything into the draft beyond what the sheet opened with: a name, a
 * test set, an evaluator, changed settings, or other app or revision picks. Closing such a draft
 * asks first; an untouched one closes at once.
 */
export const draftHasInput = (
    draft: NewEvaluationDraft,
    initial: Pick<InitialDraftOptions, "app" | "revisions"> = {},
): boolean => {
    const initialRevisionIds = new Set((initial.revisions ?? []).map((revision) => revision.id))
    const revisionsChanged =
        draft.revisions.length !== initialRevisionIds.size ||
        draft.revisions.some((revision) => !initialRevisionIds.has(revision.id))
    return (
        draft.name.trim() !== "" ||
        draft.testset !== null ||
        draft.evaluators.length > 0 ||
        !isDefaultConcurrency(draft.concurrency) ||
        (draft.app?.id ?? null) !== (initial.app?.id ?? null) ||
        revisionsChanged
    )
}

export const newEvaluationReducer = (
    state: NewEvaluationDraft,
    action: NewEvaluationAction,
): NewEvaluationDraft => {
    switch (action.type) {
        case "pickApp": {
            if (state.app?.id === action.app.id) return state
            return {
                ...createInitialDraft(state.kind, {app: action.app, suffix: state.suffix}),
                section: "revision",
            }
        }
        case "clearApp":
            return createInitialDraft(state.kind, {suffix: state.suffix})
        case "hydrateApp":
            return state.app?.id === action.app.id ? {...state, app: action.app} : state
        case "pickRevision": {
            const {revision} = action
            if (state.kind === "human") {
                const next = {...state, revisions: [revision], section: "testset" as const}
                return followAutoName(state, next)
            }
            const picked = state.revisions.some((item) => item.id === revision.id)
            const revisions = picked
                ? state.revisions.filter((item) => item.id !== revision.id)
                : [...state.revisions, revision]
            return followAutoName(state, {...state, revisions})
        }
        case "removeRevision":
            return followAutoName(state, {
                ...state,
                revisions: state.revisions.filter((item) => item.id !== action.revisionId),
            })
        case "pickTestset": {
            // Picking the selected test set revision again clears it.
            if (state.testset?.revisionId === action.testset.revisionId) {
                return followAutoName(state, {...state, testset: null})
            }
            return followAutoName(state, {
                ...state,
                testset: action.testset,
                section: "evaluators",
            })
        }
        case "clearTestset":
            return followAutoName(state, {...state, testset: null})
        case "pickEvaluator": {
            const {evaluator} = action
            if (state.evaluators.some((item) => item.revisionId === evaluator.revisionId)) {
                return {
                    ...state,
                    evaluators: state.evaluators.filter(
                        (item) => item.revisionId !== evaluator.revisionId,
                    ),
                }
            }
            // A human run names each annotation step after its evaluator, so one revision each.
            const others =
                state.kind === "human"
                    ? state.evaluators.filter((item) => item.evaluatorId !== evaluator.evaluatorId)
                    : state.evaluators
            return {...state, evaluators: [...others, evaluator]}
        }
        case "removeEvaluator":
            return {
                ...state,
                evaluators: state.evaluators.filter(
                    (item) => item.revisionId !== action.revisionId,
                ),
            }
        case "clearEvaluators":
            return {...state, evaluators: []}
        case "setConcurrency":
            return {...state, concurrency: {...state.concurrency, [action.field]: action.value}}
        case "resetConcurrency":
            return {...state, concurrency: defaultConcurrency()}
        case "setName":
            return {...state, name: action.name}
        case "blurName":
            return state.name.trim() === "" ? {...state, name: state.autoName} : state
        case "openSection":
            return {...state, section: action.section}
    }
}

export interface DraftProblem {
    /** The section to open so the user can fix it. */
    section: NewEvaluationSection
    message: string
}

/** The first failing check, in the order the user meets them. Null when the draft can start. */
export const validateDraft = (draft: NewEvaluationDraft): DraftProblem | null => {
    if (!draft.name.trim()) {
        return {section: draft.section, message: "Please enter evaluation name"}
    }
    if (!draft.testset) {
        return {section: "testset", message: "Please select a test set revision"}
    }
    if (draft.revisions.length === 0) {
        return {section: "revision", message: "Please select a revision"}
    }
    if (draft.evaluators.length === 0) {
        return {section: "evaluators", message: "Please select evaluator configuration"}
    }
    if (
        draft.kind === "auto" &&
        CONCURRENCY_FIELDS.some(({field}) => draft.concurrency[field] === null)
    ) {
        return {section: "settings", message: "This field is required"}
    }
    if (!draft.app) return {section: "application", message: "Please select an application"}
    return null
}

const VARIABLE_PATTERN = /\{\{([^{}]+)\}\}/g

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

/** A config value is either plain or wrapped as `{value}`. */
const unwrap = (value: unknown): unknown => asRecord(value)?.value ?? value

const promptVariables = (content: unknown): string[] => {
    const body = unwrap(content)
    if (typeof body === "string") {
        return [...body.matchAll(VARIABLE_PATTERN)].map((match) => match[1])
    }
    if (!Array.isArray(body)) return []
    return body.flatMap((part) => promptVariables(asRecord(part)?.text))
}

/**
 * The input variables a revision expects: `input_keys` of its config sections joined with the
 * `{{name}}` variables of its prompt messages. Names are trimmed and listed once.
 */
export const expectedInputVariables = (
    revisions: readonly {data?: {parameters?: unknown} | null}[],
): string[] => {
    const names = new Set<string>()
    for (const revision of revisions) {
        const parameters = asRecord(revision.data?.parameters) ?? {}
        const config = asRecord(parameters.ag_config) ?? parameters

        for (const section of Object.values(config)) {
            const keys = asRecord(section)?.input_keys
            if (!Array.isArray(keys)) continue
            for (const key of keys) {
                if (typeof key === "string" && key.trim()) names.add(key.trim())
            }
        }

        const prompts = config.prompt ?? parameters.prompts ?? []
        for (const prompt of Array.isArray(prompts) ? prompts : [prompts]) {
            const messages = unwrap(asRecord(prompt)?.messages)
            if (!Array.isArray(messages)) continue
            for (const message of messages) {
                for (const name of promptVariables(asRecord(message)?.content)) {
                    if (name.trim()) names.add(name.trim())
                }
            }
        }
    }
    return [...names]
}
