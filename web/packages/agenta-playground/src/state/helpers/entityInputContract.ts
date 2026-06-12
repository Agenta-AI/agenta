/**
 * Entity input contract resolution.
 *
 * Single source of truth for "what testcase row keys does this entity
 * legitimately consume as inputs". Used to reconcile shared testcase rows
 * when the primary entity changes (#4525 / AGE-3793) — the testcase store is
 * shared across loadables, so a row keeps every key the *previous* primary
 * populated (chat `messages`, a prior completion app's template variables,
 * etc.). Those stale keys must not leak into the new entity's request body.
 *
 * CRITICAL: the allow-list is derived from `inputPorts`, NOT
 * `inputSchema.properties`. Completion apps express their variables as prompt
 * template placeholders surfaced through `inputPorts`; their static
 * `inputSchema.properties` is EMPTY. Reading the schema there yields an empty
 * allow-list and the filter degrades to "keep everything" — which is exactly
 * the bug. `inputPorts` is also the same source `executionItems` uses to
 * build the request `variables`, so filtering against it is guaranteed
 * consistent with what actually gets sent.
 */
import {
    extractSectionOpenersFromConfig,
    extractVariablesFromConfig,
    groupTemplateVariables,
    resolveTemplateFormat,
} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {Getter} from "jotai"

/**
 * Chat-conversation transport keys. They accumulate on a shared testcase row
 * when a chat app runs and are not template variables — they describe a
 * conversation. Stripped from non-chat entities. Kept conservative (only
 * `messages`); `chatHistory` is rebuilt at runtime from the flat message
 * store, never stored on row data.
 */
export const CHAT_TRANSPORT_KEYS = ["messages"] as const

export interface EntityInputContract {
    /**
     * Keys the entity legitimately consumes as testcase inputs. Includes
     * `messages` for chat apps. Empty when nothing could be resolved.
     */
    allowedKeys: Set<string>
    /**
     * True when we have a confident allow-list to strict-filter against:
     * the entity surfaced at least one input variable, or it's a chat app
     * (an empty-variable chat app is still valid — it consumes `messages`).
     */
    resolved: boolean
    /**
     * Evaluators get OPEN-schema treatment: they may spread arbitrary extra
     * testcase columns (`additionalProperties`), so we never strict-filter
     * their rows — only strip known chat-transport keys.
     */
    isEvaluator: boolean
    /** Chat apps keep `messages`. */
    isChat: boolean
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0
}

/**
 * Resolve the input contract for an entity, mirroring the variable
 * resolution in `executionItems.ts` exactly:
 *
 *   variablesFromInputPorts = inputPorts[].key
 *   variablesFromPayload     = requestPayload.__meta.variables
 *                              ?? requestPayload.variables ?? []
 *   variables = inputPorts.length > 0 ? inputPorts : payload
 *
 * plus `messages` when the entity runs in chat mode.
 */
export function resolveEntityInputContract(get: Getter, entityId: string): EntityInputContract {
    const entity = get(workflowMolecule.selectors.data(entityId)) as
        | {flags?: Record<string, unknown> | null}
        | null
        | undefined
    const isEvaluator = !!entity?.flags?.is_evaluator

    const mode = get(workflowMolecule.selectors.executionMode(entityId)) as
        | "chat"
        | "completion"
        | undefined
    const isChat = mode === "chat"

    const inputPorts = (get(workflowMolecule.selectors.inputPorts(entityId)) ?? []) as {
        key?: unknown
    }[]
    const variablesFromInputPorts = Array.from(
        new Set(inputPorts.map((port) => port?.key).filter(isNonEmptyString)),
    )

    const requestPayload = get(workflowMolecule.selectors.requestPayload(entityId)) as
        | {variables?: unknown; __meta?: {variables?: unknown} | null}
        | null
        | undefined
    const metaVariables = requestPayload?.__meta?.variables
    const payloadVariables = requestPayload?.variables
    const rawPayloadVariables: unknown[] = Array.isArray(metaVariables)
        ? metaVariables
        : Array.isArray(payloadVariables)
          ? payloadVariables
          : []
    const variablesFromPayload = rawPayloadVariables.filter(isNonEmptyString)

    const variables =
        variablesFromInputPorts.length > 0 ? variablesFromInputPorts : variablesFromPayload

    const allowedKeys = new Set(variables)
    if (isChat) allowedKeys.add("messages")

    const resolved = variables.length > 0 || isChat

    return {allowedKeys, resolved, isEvaluator, isChat}
}

export type ReconcileStrategy = "strict" | "chat-transport" | "skip"

export interface ReconcileResult {
    /** The reconciled data (new object only when keys were dropped). */
    data: Record<string, unknown>
    /** Keys that were removed. Empty when nothing changed. */
    dropped: string[]
    /** Which policy ran. */
    strategy: ReconcileStrategy
}

export interface ReconcileOptions {
    /**
     * Keys to keep even when they aren't in the entity's allow-list. Used to
     * protect testcase columns that a DOWNSTREAM evaluator consumes via its
     * `<input>_key` settings (e.g. `correct_answer_key → ground_truth`). The
     * primary app doesn't declare them, but they're intentional evaluation
     * columns — not stale leftovers — so a strict clean must not drop them.
     */
    protectedKeys?: ReadonlySet<string>
}

/**
 * Reconcile a row's data to an entity's input contract.
 *
 * Policy:
 *  - Evaluator → `chat-transport`: only strip chat-transport keys the entity
 *    doesn't declare. Preserves evaluators that spread additional testcase
 *    columns.
 *  - App with a resolved contract → `strict`: keep only declared (or
 *    protected) keys.
 *  - Unresolved (schema/ports mid-hydration, non-evaluator) → `chat-transport`
 *    as a safety net; the caller may choose to defer a strict pass until the
 *    contract resolves.
 */
export function reconcileRowDataForEntity(
    get: Getter,
    entityId: string,
    data: Record<string, unknown>,
    options?: ReconcileOptions,
): ReconcileResult {
    const contract = resolveEntityInputContract(get, entityId)
    const protectedKeys = options?.protectedKeys

    const useStrict = !contract.isEvaluator && contract.resolved

    if (useStrict) {
        const dropped: string[] = []
        const next: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(data)) {
            if (contract.allowedKeys.has(key) || protectedKeys?.has(key)) {
                next[key] = value
            } else {
                dropped.push(key)
            }
        }
        return dropped.length > 0
            ? {data: next, dropped, strategy: "strict"}
            : {data, dropped, strategy: "strict"}
    }

    // chat-transport strip (evaluators + unresolved contracts)
    const dropped: string[] = []
    const next: Record<string, unknown> = {...data}
    for (const key of CHAT_TRANSPORT_KEYS) {
        if (key in next && !contract.allowedKeys.has(key) && !protectedKeys?.has(key)) {
            delete next[key]
            dropped.push(key)
        }
    }
    return dropped.length > 0
        ? {data: next, dropped, strategy: "chat-transport"}
        : {data, dropped, strategy: "chat-transport"}
}

/**
 * Collect testcase column names that downstream evaluator nodes consume.
 *
 * An evaluator pulls a testcase column in two ways, and the primary app's
 * strict row clean must protect both (pass the result as
 * `reconcileRowDataForEntity`'s `protectedKeys`):
 *
 *  1. A `<input>_key` setting whose value names the column (e.g.
 *     `correct_answer_key → ground_truth`). Mirrors the `<key>_key` resolution
 *     in `buildEvaluatorExecutionInputs` (`@agenta/entities/runnable`): a string
 *     value naming a column, optionally prefixed `testcase.`.
 *  2. A template variable in the evaluator's own prompt — an LLM-as-a-judge
 *     referencing `{{guidelines.rubric}}` consumes the `guidelines` column. The
 *     primary app never declares it, so without this the strict clean drops it
 *     from the shared row before the evaluator runs (#4525 regression).
 *
 * These columns are intentional evaluation inputs the primary app doesn't
 * declare, so a strict clean against the app contract must keep them.
 */
export function collectDownstreamReferencedColumns(
    get: Getter,
    nodes: readonly {depth: number; entityId: string}[],
): Set<string> {
    const columns = new Set<string>()
    for (const node of nodes) {
        if (node.depth === 0) continue
        const settings = get(workflowMolecule.selectors.configuration(node.entityId)) as
            | Record<string, unknown>
            | null
            | undefined
        if (!settings || typeof settings !== "object") continue

        // 1. `<input>_key` settings that map a column by name.
        for (const [key, value] of Object.entries(settings)) {
            if (!key.endsWith("_key")) continue
            if (typeof value !== "string" || value.length === 0) continue
            const column = value.startsWith("testcase.") ? value.split(".")[1] : value
            if (column) columns.add(column)
        }

        // 2. Columns the evaluator's own prompt references as template
        //    variables. Evaluators surface the `{inputs, outputs}` envelope as
        //    their input ports, so these prompt references never appear in
        //    `inputPorts` — we extract them here directly from the config.
        for (const column of collectPromptInputColumns(settings)) {
            columns.add(column)
        }
    }
    return columns
}

/**
 * Evaluator input names that are injected at runtime, never sourced from a
 * testcase column: `prediction`/`outputs` carry the upstream output, `inputs` is
 * the whole testcase object, and `messages` is chat transport. A prompt
 * referencing one of these must not protect a same-named row key from the
 * reconcile clean — `buildEvaluatorExecutionInputs` supplies them at run time,
 * and protecting `messages` would defeat the chat-transport strip (#4525).
 */
const RESERVED_EVALUATOR_INPUT_KEYS = new Set<string>([
    "prediction",
    "outputs",
    "inputs",
    ...CHAT_TRANSPORT_KEYS,
])

/**
 * Memoizes the prompt parse per config object. `configuration(entityId)` returns
 * a stable reference across the rows of a run (it only changes when the config
 * is edited), so this keeps the per-row reconcile from re-parsing every
 * evaluator prompt on every row.
 */
const promptInputColumnsCache = new WeakMap<Record<string, unknown>, string[]>()

/**
 * Extract the testcase input columns an entity's prompt references as template
 * variables. Mirrors the input-port derivation in the workflow molecule: pull
 * every template variable from the config, group them, and keep the `inputs`-
 * envelope keys that name a real testcase column. Runtime-resolved references
 * (`{{$.outputs.score}}`, plus the reserved names above) are excluded.
 *
 * Template format defaults to `curly` when unset, matching both
 * `extractVariablesFromConfig` (which extracts each prompt with a curly default)
 * and the evaluator picker's curly fallback for legacy judges. So a curly dotted
 * reference like `{{guidelines.rubric}}` groups to the literal column
 * `guidelines.rubric` (the backend curly resolver's literal-key lookup) instead
 * of being mis-split to `guidelines`.
 */
function collectPromptInputColumns(config: Record<string, unknown>): string[] {
    const cached = promptInputColumnsCache.get(config)
    if (cached) return cached

    const vars = extractVariablesFromConfig(config)
    const sectionOpeners = extractSectionOpenersFromConfig(config)
    const promptObj = config.prompt as Record<string, unknown> | undefined
    const rawTemplateFormat =
        (promptObj?.template_format as string | undefined) ??
        (config.template_format as string | undefined)
    const templateFormat = resolveTemplateFormat(rawTemplateFormat) ?? "curly"

    const columns =
        vars.length === 0
            ? []
            : groupTemplateVariables(vars, {sectionOpeners, templateFormat})
                  .filter((group) => group.envelope === "inputs")
                  .map((group) => group.key)
                  .filter(
                      (key): key is string =>
                          typeof key === "string" &&
                          key.length > 0 &&
                          !RESERVED_EVALUATOR_INPUT_KEYS.has(key),
                  )

    promptInputColumnsCache.set(config, columns)
    return columns
}
