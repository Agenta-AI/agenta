import type {DataType} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"

/**
 * Determines if a data type supports raw mode toggle.
 * Raw mode shows the stringified JSON representation instead of a formatted/specialized view.
 *
 * Data types that support raw mode:
 * - string: Can toggle between text editor and JSON string view
 * - messages: Can toggle between chat message list and raw JSON
 * - json-object: Can toggle between formatted JSON and raw stringified view
 * - json-array: Can toggle between formatted JSON and raw stringified view
 * - boolean: Can toggle between switch and JSON primitive view
 * - number: Can toggle between number input and JSON primitive view
 */
export function canToggleRawMode(dataType: DataType): boolean {
    return (
        dataType === "string" ||
        dataType === "messages" ||
        dataType === "json-object" ||
        dataType === "json-array" ||
        dataType === "boolean" ||
        dataType === "number"
    )
}
