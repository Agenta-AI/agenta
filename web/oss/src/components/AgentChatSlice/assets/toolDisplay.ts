/**
 * Tool-step display foundation: the one place a raw runtime tool name (AI SDK part) becomes what
 * the chat UI shows. Resolution order: per-tool registry override → name-shape heuristics
 * (`mcp__…`, gateway double-underscore forms) → title-cased raw name. Same dispatch idea as the
 * approvals/clientTools registries — grow BY_TOOL_NAME for special cases; nothing here is
 * load-bearing for unknown tools. Raw names stay reachable via tooltips and Build mode.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"
import type {ToolUIPart} from "ai"

/** Best-effort tool family, inferred from the wire-name shape only. */
export type ToolKind = "gateway" | "mcp" | "platform"

export interface ToolDisplay {
    /** Humanized action label ("Fetch emails"). */
    label: string
    /** Where the tool comes from ("Gmail", "Linear · MCP"). */
    source?: string
    /** The wire name — always kept reachable (tooltips, Build mode, traces). */
    raw: string
    kind: ToolKind
    /** Friendly one-liner for a settled row; null/absent falls back to the generic summary. */
    summary?: (input: unknown, output: unknown) => string | null
}

interface ToolDisplayOverride {
    label?: string
    source?: string
    summary?: (input: unknown, output: unknown) => string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** Special cases, keyed by wire name. */
const BY_TOOL_NAME: Record<string, ToolDisplayOverride> = {
    commit_revision: {
        summary: (input) => {
            const commit =
                isRecord(input) && isRecord(input.workflow_revision)
                    ? input.workflow_revision
                    : null
            return typeof commit?.message === "string" && commit.message ? commit.message : null
        },
    },
}

const parseNameShape = (raw: string): {label: string; source?: string; kind: ToolKind} => {
    // mcp__{server}__{tool} → tool from "Server · MCP".
    if (raw.startsWith("mcp__")) {
        const parts = raw.split("__").filter(Boolean)
        const tool = parts[parts.length - 1]
        const server = parts.length >= 3 ? parts[1] : undefined
        return {
            label: parseGatewayToolName(tool).label,
            source: server ? `${parseGatewayToolName(server).label} · MCP` : "MCP",
            kind: "mcp",
        }
    }
    const parsed = parseGatewayToolName(raw)
    return {...parsed, kind: parsed.source ? "gateway" : "platform"}
}

/** Resolve display info for a raw runtime tool name. Pure and total — never throws. */
export const resolveToolDisplay = (raw: string): ToolDisplay => {
    const override = BY_TOOL_NAME[raw]
    const parsed = parseNameShape(raw)
    return {
        raw,
        kind: parsed.kind,
        label: override?.label ?? parsed.label,
        source: override?.source ?? parsed.source,
        summary: override?.summary,
    }
}

/**
 * Longest call description we render, counted in CODE POINTS.
 *
 * The catalog caps the model at the same number, and JSON Schema `maxLength` counts code points
 * too, so both ends measure the same string the same way.
 */
export const CALL_DESCRIPTION_MAX_LENGTH = 500

export interface CallDescription {
    text: string
    /** True when the text was cut — the caller must show that it was. */
    truncated: boolean
}

/**
 * The agent's own note about a builder tool call (R12), read from the call's arguments.
 *
 * It rides in `input.description` because the runner strips it only at dispatch, so the recorded
 * call keeps it on both the live and the replay path. This is model text, never a fact.
 */
export const extractCallDescription = (input: unknown): CallDescription | null => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null
    const raw = (input as {description?: unknown}).description
    if (typeof raw !== "string") return null
    const text = raw.trim()
    if (!text) return null
    // Cut on code points, not UTF-16 units: `slice` at the cap can land inside a surrogate pair and
    // emit a lone half, which renders as a replacement character.
    const points = Array.from(text)
    if (points.length <= CALL_DESCRIPTION_MAX_LENGTH) return {text, truncated: false}
    return {text: points.slice(0, CALL_DESCRIPTION_MAX_LENGTH).join(""), truncated: true}
}

/** Wire name of a tool part. `dynamic-tool` carries it on `toolName`; typed parts encode it as
 * `tool-<name>`. */
export const partToolName = (part: ToolUIPart): string => {
    // `dynamic-tool` parts reach here via the grouping cast in AgentMessage but sit outside
    // ToolUIPart's static union — read `type` as a string.
    const type = part.type as string
    if (type === "dynamic-tool") {
        return (part as {toolName?: string}).toolName || "tool"
    }
    return type.replace(/^tool-/, "")
}
