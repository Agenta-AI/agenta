/**
 * Small, pure helpers shared across the agent-template config sections. No React, no state — kept
 * separate so the section components and the orchestrator can reuse them (and so they're testable).
 */
import type {SchemaProperty} from "@agenta/entities/shared"

/**
 * Best-effort display label for an enum value, used in collapsed section summaries.
 * Reads `x-model-metadata` titles and `anyOf`/`oneOf` const titles, falling back to the
 * raw value so a summary is always shown.
 */
export function enumLabel(schema: SchemaProperty | undefined, value: unknown): string | null {
    if (value == null || value === "") return null
    const v = String(value)
    const s = schema as Record<string, unknown> | undefined
    const meta = s?.["x-model-metadata"] as Record<string, {name?: string}> | undefined
    if (meta?.[v]?.name) return meta[v]!.name as string
    const variants = (s?.anyOf ?? s?.oneOf) as {const?: unknown; title?: string}[] | undefined
    const hit = variants?.find((o) => o?.const === value)
    if (hit?.title) return hit.title
    return v
}

/** "3 tools" / "1 server" / "None" — the count line shown in a collapsed section header. */
export const countSummary = (n: number, noun: string): string =>
    n > 0 ? `${n} ${noun}${n === 1 ? "" : "s"}` : "None"

/** Deep-clone a config item so drawer edits don't alias the committed config object. */
export function cloneItem(item: unknown): Record<string, unknown> {
    if (!item || typeof item !== "object") return {}
    return JSON.parse(JSON.stringify(item)) as Record<string, unknown>
}
