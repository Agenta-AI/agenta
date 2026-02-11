// @ts-nocheck

/** String manipulation utilities */
export const toCamelCase = (str: string): string =>
    str.replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace(/[-_]/g, ""))

export const toSnakeCase = (str: string): string =>
    str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

export const constructPlaygroundTestUrl = (
    uri: {routePath?: string; runtimePrefix?: string},
    endpoint = "/test",
    withPrefix = true,
) => {
    return `${withPrefix ? uri.runtimePrefix || "" : ""}${uri.routePath ? `/${uri.routePath}` : ""}${endpoint}`
}
