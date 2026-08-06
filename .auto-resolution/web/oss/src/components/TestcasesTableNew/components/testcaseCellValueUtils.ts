import {tryParseJson} from "@agenta/ui/cell-renderers"

export function parseTestcaseCellJson(value: unknown): {parsed: unknown; isJson: boolean} {
    if (typeof value === "string") {
        return {parsed: value, isJson: false}
    }

    return tryParseJson(value)
}
