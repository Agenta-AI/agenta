/**
 * The desktop chat's tool-display seam. The naming/summary system — the verb table, the platform
 * glossary, the shape parsers and the harness-wrapper unwrapping — lives in @agenta/chat/skin so
 * every host words a call the same way; this module re-exports it under the names the desktop
 * chat already imports, and keeps the one piece that is only ours (the call description).
 * Desktop-specific display overrides go through `registerChatSkin({toolDisplay})` from here.
 */
import {
    canonicalToolName,
    inSentence,
    resolveToolDisplay as resolveFromSkin,
} from "@agenta/chat/skin"
import type {
    ResolvedToolDisplay,
    ToolActivity as SkinToolActivity,
    ToolKind as SkinToolKind,
} from "@agenta/chat/skin"

export type ToolKind = SkinToolKind
export type ToolActivity = SkinToolActivity
export type ToolDisplay = ResolvedToolDisplay

export {canonicalToolName, inSentence}

/**
 * Resolve display info for a raw runtime tool name. Pure and total — never throws.
 *
 * `input`/`output` are optional; callers wanting only a label may omit them. `appName` comes from
 * the catalog, which answers late: resolve once without it, look up `sourceKey`, resolve again.
 */
export const resolveToolDisplay = (
    raw: string,
    input?: unknown,
    appName?: string,
    output?: unknown,
): ToolDisplay => resolveFromSkin(raw, input, appName, output)

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
