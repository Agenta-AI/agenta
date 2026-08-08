/**
 * Tool-step display foundation: the one place a raw runtime tool name (AI SDK part) becomes what
 * the chat UI shows. Resolution order: per-tool registry override → name-shape heuristics
 * (`mcp__…`, gateway double-underscore forms) → title-cased raw name. The store, the parsing
 * chain and the harness-wrapper unwrapping live in @agenta/chat/skin; this module registers the
 * desktop's special cases at import time and re-exports the resolver under the old name. Raw
 * names stay reachable via tooltips and Build mode.
 */
import {
    canonicalToolName,
    registerChatSkin,
    resolveToolDisplay as resolveFromSkin,
} from "@agenta/chat/skin"
import type {ResolvedToolDisplay, ToolKind as SkinToolKind} from "@agenta/chat/skin"

export type ToolKind = SkinToolKind
export type ToolDisplay = ResolvedToolDisplay

export {canonicalToolName}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

registerChatSkin({
    toolDisplay: {
        commit_revision: {
            summary: (input) => {
                const commit =
                    isRecord(input) && isRecord(input.workflow_revision)
                        ? input.workflow_revision
                        : null
                return typeof commit?.message === "string" && commit.message ? commit.message : null
            },
        },
    },
})

/** Resolve display info for a raw runtime tool name. Pure and total — never throws. */
export const resolveToolDisplay = (raw: string): ToolDisplay => resolveFromSkin(raw)

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
