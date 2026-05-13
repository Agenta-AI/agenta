/**
 * Remove trailing slash from a URI string.
 */
export const removeTrailingSlash = (uri: string) => {
    return uri.endsWith("/") ? uri.slice(0, -1) : uri
}
