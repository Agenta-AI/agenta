// Utility to normalize JSON strings for comparison (ignoring formatting)
export function normalizeJsonString(jsonString: string): string | null {
    try {
        // Try to parse, then re-stringify with a canonical format
        const parsed = JSON.parse(jsonString)
        // Always use 2-space indentation for normalization
        return JSON.stringify(parsed, null, 2)
    } catch (e) {
        // If not valid JSON, return null
        return null
    }
}
