/**
 * normalizeJson — dirty-state helper shared by the schedule and subscription trigger
 * drawers, which both compare a normalized snapshot against the loaded entity.
 */

// Compact a JSON string for stable comparison (so formatting doesn't count as a
// change when computing the dirty state).
export function normalizeJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text))
    } catch {
        return text
    }
}
