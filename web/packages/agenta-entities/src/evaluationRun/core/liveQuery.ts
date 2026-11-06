/**
 * Live evaluation query helpers.
 *
 * A live evaluation reads traces through a stored query: trace filter rows
 * (the `filtering` part) and a sampling rate (the `windowing` part). These pure
 * helpers turn the form values into that query payload.
 *
 * @packageDocumentation
 */

import type {AgentaApi} from "@agentaai/api-client"

import {isOnlineCapableEvaluator} from "../../workflow/core/schema"

/**
 * One trace filter row. Structurally the same as the `Filter` type of
 * `@agenta/observability`, which this package cannot import.
 */
export interface LiveFilterRow {
    field: string
    key?: string
    operator: string
    value: unknown
    isPermanent?: boolean
}

type LiveQueryCondition = AgentaApi.Condition
type LiveQueryFiltering = AgentaApi.FilteringInput
type LiveQueryWindowing = AgentaApi.Windowing
export type LiveQueryData = AgentaApi.QueryRevisionDataInput

/** Locked first row of every live evaluation query: only invocation traces. */
export const LIVE_INVOCATION_FILTER = {
    field: "trace_type",
    operator: "is",
    value: "invocation",
    isPermanent: true,
} as const satisfies LiveFilterRow

const slugify = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")

/** Query slug: the slugged name (or "online-evaluation") and a unique suffix. */
export function buildQuerySlug(name: string, suffix: string): string {
    return `${slugify(name) || "online-evaluation"}-${suffix}`
}

/** Filter rows as query conditions. A `references` row never carries a key. */
export function toFilteringPayload(filters: LiveFilterRow[]): LiveQueryFiltering | undefined {
    const conditions = filters
        .filter((filter) => filter.field)
        .map((filter): LiveQueryCondition => {
            // The filter builder checks the operator and the value of each row, so they are
            // trusted here as the wire types.
            const condition: LiveQueryCondition = {
                field: filter.field,
                operator: (filter.operator.trim() || "is") as AgentaApi.Condition.Operator,
                value: filter.value as AgentaApi.Condition.Value,
            }
            const key = filter.key?.trim()
            if (key && filter.field !== "references") condition.key = key
            return condition
        })
    return conditions.length ? {operator: "and", conditions} : undefined
}

/** Sampling rate in percent as the query windowing (a fraction between 0 and 1). */
export function toWindowingPayload(samplingRate: number | null): LiveQueryWindowing | undefined {
    if (samplingRate === null) return undefined
    return {rate: Math.min(Math.max(samplingRate / 100, 0), 1)}
}

/** Sampling rate input as a whole percent between 0 and 100, or null when empty. */
export function parseSamplingRate(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null
    const n = typeof value === "number" ? value : Number(value)
    if (Number.isNaN(n)) return null
    return Math.min(Math.max(Math.round(n), 0), 100)
}

/** Evaluators that can run on live traces: online capable and not human (feedback). */
export function selectLiveEvaluators<
    T extends {
        flags?: Record<string, unknown> | null
        data?: {uri?: string | null} | null
        meta?: Record<string, unknown> | null
        slug?: string | null
    },
>(revisions: T[]): T[] {
    return revisions.filter(
        (revision) => revision.flags?.is_feedback !== true && isOnlineCapableEvaluator(revision),
    )
}

/** A stored query's filtering, as the API returns it: conditions or nested groups. */
export interface QueryFilteringText {
    operator?: string | null
    conditions?: readonly (QueryConditionText | QueryFilteringText)[] | null
}

interface QueryConditionText {
    field?: string | null
    key?: string | null
    operator?: string | null
    value?: unknown
}

const valueText = (value: unknown): string => {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/**
 * A query's filtering as one line, as the old app's overview prints it:
 * `trace_type is invocation AND references in [...]`. Groups are in parentheses. "—" for none.
 */
export function formatQueryFiltering(filtering: QueryFilteringText | null | undefined): string {
    const parts = (filtering?.conditions ?? []).map((condition) =>
        "conditions" in condition && condition.conditions
            ? `(${formatQueryFiltering(condition as QueryFilteringText)})`
            : (() => {
                  const c = condition as QueryConditionText
                  return `${c.field || c.key || "field"} ${c.operator || "=="} ${valueText(c.value)}`
              })(),
    )
    return parts.length ? parts.join(` ${(filtering?.operator || "and").toUpperCase()} `) : "—"
}

/** A query's sampling rate (a fraction) as a percent, "—" when it has none. */
export function formatQuerySampleRate(rate: unknown): string {
    if (typeof rate !== "number" || Number.isNaN(rate) || rate < 0 || rate > 1) return "—"
    return `${Math.round(rate * 10000) / 100}%`
}

/** One stored query condition, as the API returns it. */
export interface StoredQueryCondition {
    field: string
    key?: string
    operator: string
    value: unknown
}

const isConditionNode = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The conditions of a stored query, depth first: nested condition groups flatten into one list,
 * the way the old app's query preview reads them. A condition with neither field nor key is
 * skipped; an empty operator reads as "is".
 */
export function flattenQueryConditions(filtering: unknown): StoredQueryCondition[] {
    if (!isConditionNode(filtering)) return []
    if (Array.isArray(filtering.conditions)) {
        return filtering.conditions.flatMap((child) => flattenQueryConditions(child))
    }
    const field = typeof filtering.field === "string" ? filtering.field : ""
    const key = typeof filtering.key === "string" && filtering.key ? filtering.key : undefined
    if (!field && !key) return []
    const operator = typeof filtering.operator === "string" ? filtering.operator.trim() : ""
    return [{field: field || key || "", key, operator: operator || "is", value: filtering.value}]
}
