/**
 * Accesses a nested property in an object using a dot and bracket notation path.
 *
 * @param {string} path - The path to the property, e.g., "a.b.c.[0].e".
 * @param {Record<string, any>} object - The object to access.
 * @returns {any} - The value at the specified path, or undefined if the path is invalid.
 */
export const accessKeyInVariant = (path: string, object: Record<string, any>): any => {
    return path
        .split(/[\.\[\]]/)
        .filter(Boolean)
        .reduce((o, i) => {
            if (o === undefined || o === null) return undefined
            return o[i]
        }, object)
}
