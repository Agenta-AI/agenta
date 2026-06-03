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

/**
 * Reconcile a row's data to an entity's input contract.
 *
 * Policy:
 *  - Evaluator → `chat-transport`: only strip chat-transport keys the entity
 *    doesn't declare. Preserves evaluators that spread additional testcase
 *    columns.
 *  - App with a resolved contract → `strict`: keep only declared keys.
 *  - Unresolved (schema/ports mid-hydration, non-evaluator) → `chat-transport`
 *    as a safety net; the caller may choose to defer a strict pass until the
 *    contract resolves.
 */
export function reconcileRowDataForEntity(
    get: Getter,
    entityId: string,
    data: Record<string, unknown>,
): ReconcileResult {
    const contract = resolveEntityInputContract(get, entityId)

    const useStrict = !contract.isEvaluator && contract.resolved

    if (useStrict) {
        const dropped: string[] = []
        const next: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(data)) {
            if (contract.allowedKeys.has(key)) {
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
        if (key in next && !contract.allowedKeys.has(key)) {
            delete next[key]
            dropped.push(key)
        }
    }
    return dropped.length > 0
        ? {data: next, dropped, strategy: "chat-transport"}
        : {data, dropped, strategy: "chat-transport"}
}
