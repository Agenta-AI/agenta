/**
 * Key path utilities for handling string or array key representations.
 */

/**
 * Converts a key (string or string array) to a dot-notation string.
 *
 * @param key - A key that can be a string, array of strings, or undefined
 * @returns A string representation of the key path, or empty string if undefined
 *
 * @example
 * keyToString("name") // returns "name"
 * keyToString(["user", "profile", "name"]) // returns "user.profile.name"
 * keyToString(undefined) // returns ""
 */
export function keyToString(key: string | string[] | undefined): string {
    if (!key) return ""
    return Array.isArray(key) ? key.join(".") : key
}

/**
 * Converts a dot-notation string to a key path array.
 *
 * @param str - A dot-notation string path
 * @returns An array of path segments
 *
 * @example
 * stringToKeyPath("user.profile.name") // returns ["user", "profile", "name"]
 * stringToKeyPath("name") // returns ["name"]
 * stringToKeyPath("") // returns []
 */
export function stringToKeyPath(str: string): string[] {
    if (!str) return []
    return str.split(".")
}
