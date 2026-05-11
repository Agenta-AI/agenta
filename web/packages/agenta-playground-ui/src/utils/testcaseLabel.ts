/**
 * Extract a short identifier from a testcase ID for display.
 *
 * Local IDs: `new-{timestamp}-{random5}` → last segment (e.g., "a2b9x")
 * Server UUIDs: `550e8400-e29b-41d4-a716-446655440000` → first 6 chars (e.g., "550e84")
 */
export function getShortTestcaseId(id: string): string {
    if (id.startsWith("new-")) {
        const parts = id.split("-")
        return parts[parts.length - 1]
    }
    // Server UUID — take first 6 hex chars
    return id.replace(/-/g, "").slice(0, 6)
}
