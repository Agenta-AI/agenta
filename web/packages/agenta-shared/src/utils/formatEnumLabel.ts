/**
 * Format enum values into readable labels.
 */
export function formatEnumLabel(value: unknown): string {
    if (typeof value !== "string") return String(value)

    return value
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}
