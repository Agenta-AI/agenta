export type ViewMode = "text" | "markdown" | "json" | "yaml" | "form"

export interface ViewOption {
    value: ViewMode
    label: string
}

/**
 * Returns the ordered view-mode options for a value.
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
        const isLong = value.length > 100 || value.includes("\n")
        return isLong
            ? [{value: "markdown", label: "Markdown"}, {value: "text", label: "Text"}, ...jsonYaml]
            : [{value: "text", label: "Text"}, {value: "markdown", label: "Markdown"}, ...jsonYaml]
    }

    if (Array.isArray(value)) {
        return jsonYaml
    }

    return enableFormView ? [{value: "form", label: "Form"}, ...jsonYaml] : jsonYaml
}
