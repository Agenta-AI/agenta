/**
 * Data URI / Base64 / URL detection utilities.
 *
 * Pure functions with no external dependencies.
 */

/** Check whether a string is a `data:…;base64,…` URI. */
export const isBase64 = (value: string): boolean => {
    return value.startsWith("data:") && value.includes(";base64,")
}

/**
 * Convert a `data:…;base64,…` URI to a blob object-URL.
 * Returns the original string when conversion fails or the input is not base64.
 */
export const dataUriToObjectUrl = (dataUri: string): string => {
    if (!isBase64(dataUri)) return dataUri
    try {
        const commaIndex = dataUri.indexOf(",")
        if (commaIndex === -1) return dataUri

        const header = dataUri.slice(0, commaIndex)
        const mimeType = header.replace("data:", "").replace(";base64", "") || "application/pdf"
        const base64 = dataUri.slice(commaIndex + 1)
        const byteCharacters = atob(base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], {type: mimeType})
        return URL.createObjectURL(blob)
    } catch (error) {
        console.error("Unable to create preview URL from data URI", error)
        return dataUri
    }
}

/** Check whether a string looks like an HTTP(S) or blob URL. */
export const isUrl = (value: string): boolean => {
    return /^(blob:)?https?:\/\//.test(value)
}
