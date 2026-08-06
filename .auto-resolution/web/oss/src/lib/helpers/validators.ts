export const isValidHttpUrl = (url: string) => {
    try {
        const newUrl = new URL(url)
        return newUrl.protocol.startsWith("http")
    } catch (_) {
        return false
    }
}

export function isValidRegex(regex: string) {
    try {
        new RegExp(regex)
        return true
    } catch (_) {
        return false
    }
}

/**
 * UUID validation regex - validates standard UUID format (v1-v5)
 * Used to prevent SSRF by ensuring IDs are valid UUIDs before using in URLs
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
    return UUID_REGEX.test(id)
}

/**
 * Validate that a string is a valid UUID, throwing an error if not
 * @param id - The string to validate
 * @param paramName - The name of the parameter (for error message)
 * @throws Error if the ID is not a valid UUID
 */
export function validateUUID(id: string, paramName: string): void {
    if (!isValidUUID(id)) {
        throw new Error(`Invalid ${paramName}: must be a valid UUID`)
    }
}
