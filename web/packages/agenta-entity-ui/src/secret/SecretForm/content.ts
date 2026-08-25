import {
    CustomSecretFormat,
    type CustomSecretContent,
    type CustomSecretFormat as CustomSecretFormatType,
} from "@agenta/entities/secret"

import {isFlatPrimitiveObject, rowsToObject, type KvRow} from "./primitives"

interface BuildSecretContentParams {
    format: CustomSecretFormatType
    originalFormat: CustomSecretFormatType
    valueHidden: boolean
    replacementSupplied: boolean
    textValue: string
    jsonView: "grid" | "json"
    jsonText: string
    kvRows: KvRow[]
}

export type SecretContentResult = {content: CustomSecretContent | undefined} | {error: string}

export const parseFlatJson = (
    jsonText: string,
): {value: Record<string, string | number | boolean | null>} | {error: string} => {
    let parsed: unknown
    try {
        parsed = JSON.parse(jsonText || "{}")
    } catch {
        return {error: "Invalid JSON."}
    }

    if (!isFlatPrimitiveObject(parsed)) {
        return {error: "Must be a flat object of primitives; nesting and arrays are not allowed."}
    }

    return {value: parsed}
}

/** Decide whether a write-only secret is preserved or deliberately replaced. */
export const buildSecretContent = ({
    format,
    originalFormat,
    valueHidden,
    replacementSupplied,
    textValue,
    jsonView,
    jsonText,
    kvRows,
}: BuildSecretContentParams): SecretContentResult => {
    if (valueHidden && !replacementSupplied) {
        if (format !== originalFormat) {
            return {error: "Enter replacement content before changing the secret format."}
        }
        return {content: undefined}
    }

    if (format === CustomSecretFormat.Text) {
        return {content: textValue}
    }

    if (jsonView === "json") {
        const parsed = parseFlatJson(jsonText)
        return "error" in parsed ? parsed : {content: parsed.value}
    }

    const namedRows = kvRows.filter((row) => row.key.trim())
    const keys = namedRows.map((row) => row.key.trim())
    if (new Set(keys).size !== keys.length) {
        return {error: "Duplicate keys are not allowed."}
    }

    return {content: rowsToObject(namedRows)}
}
