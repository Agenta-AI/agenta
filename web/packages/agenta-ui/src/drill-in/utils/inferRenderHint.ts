export type {RenderHint} from "../../type-chip/TypeChip"
import type {RenderHint} from "../../type-chip/TypeChip"

/**
 * Infers the optional render-hint chip for a value.
 *
 * Render hints are orthogonal to primitive type chips. Callers can emit both
 * when the surface has render hints enabled.
 */
export function inferRenderHint(value: unknown): RenderHint | null {
    if (Array.isArray(value)) {
        if (value.length === 0) return null

        const first = value[0]
        if (first && typeof first === "object") {
            if ("role" in first) return "messages"
            if (
                "type" in first &&
                (first as {type?: unknown}).type === "function" &&
                "function" in first
            ) {
                return "tool-calls"
            }
        }

        return null
    }

    if (typeof value === "string") {
        if (value.length >= 2 && (value[0] === "{" || value[0] === "[")) {
            try {
                const parsed = JSON.parse(value)
                if (parsed && typeof parsed === "object") return "stringified"
            } catch {
                // Not parseable, fall through to markdown heuristic.
            }
        }

        if (value.length > 100 || value.includes("\n")) return "markdown"
        return null
    }

    return null
}
