import {tryParseJson} from "@agenta/ui/cell-renderers"

export function parseTestcaseCellJson(value: unknown): {parsed: unknown; isJson: boolean} {
    if (typeof value !== "string") {
        return tryParseJson(value)
    }

    const trimmed = value.trim()
    const canBeJsonContainer =
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))

    if (!canBeJsonContainer) {
        return {parsed: value, isJson: false}
    }

    try {
        return {parsed: JSON.parse(trimmed), isJson: true}
    } catch {
        return {parsed: value, isJson: false}
    }
}
