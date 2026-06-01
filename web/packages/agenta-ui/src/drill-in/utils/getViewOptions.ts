export type ViewMode = "text" | "markdown" | "json" | "yaml" | "form"

export interface ViewOption {
    value: ViewMode
    label: string
}

/**
 * Returns the ordered view-mode options for a value.
 *
 * Order convention is consistent regardless of content: kind-specific
 * modes first (Text → Markdown for strings, Form for objects), JSON and
 * YAML always at the bottom. A previous heuristic flipped the string
 * options to "Markdown first" for "long" strings (>100 chars OR
 * containing `\n`) on the theory that long multi-line text is more
 * likely markdown — but Kaosiso reported on 2026-06-01 that "Text and
 * markdown are incorrectly swapped" in the chat message editor, and
 * Arda confirmed the order must be consistent across content. Reordering
 * based on heuristics confuses users: pick the SAME option, get it in a
 * different slot depending on what you happened to type. The default
 * MODE (what the dropdown shows initially) can still be markdown-leaning
 * elsewhere; the option ORDER stays put.
 */
export function getViewOptions(value: unknown, enableFormView = false): ViewOption[] {
    const jsonYaml: ViewOption[] = [
        {value: "json", label: "JSON"},
        {value: "yaml", label: "YAML"},
    ]

    if (value === null || typeof value === "number" || typeof value === "boolean") {
        return jsonYaml
    }

    if (typeof value === "string") {
        return [{value: "text", label: "Text"}, {value: "markdown", label: "Markdown"}, ...jsonYaml]
    }

    if (Array.isArray(value)) {
        return jsonYaml
    }

    return enableFormView ? [{value: "form", label: "Form"}, ...jsonYaml] : jsonYaml
}
