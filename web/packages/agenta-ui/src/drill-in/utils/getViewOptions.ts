export type ViewMode = "text" | "markdown" | "json" | "yaml" | "form"

export interface ViewOption {
    value: ViewMode
    label: string
}

/**
 * Returns the ordered view-mode options for a value.
 *
 * Order convention is fixed: kind-specific modes first (Text → Markdown
 * for strings, Form for objects), JSON and YAML always at the bottom.
 * No content-based heuristics — every string gets the same options in
 * the same order, regardless of length, newlines, or what the user
 * has typed. Arda directive on 2026-06-01 (after Kaosiso reported
 * "text and markdown are incorrectly swapped" in the chat message
 * editor): "no more 'long' string logic in the playground variables
 * / inputs". A prior implementation flipped the string branch to
 * "Markdown first" when the value exceeded 100 chars OR contained a
 * `\n`; that's gone now.
 *
 * Default mode selection (the dropdown's initial pick) is decoupled
 * from this — callers either hard-set it (`useState("text")` in
 * `ChatMessageList`) or derive it from the first option of this list
 * (`getDefaultViewForValue` in `@agenta/entity-ui/view-types`). Since
 * Text is always first, Text is always the default for strings.
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
