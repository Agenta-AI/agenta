import {dataUriToObjectUrl, isBase64} from "@agenta/shared/utils"

/**
 * Validates that a URL is a safe image source (http/https image URLs,
 * blob: URLs, or data:image base64 URIs). Rejects anything else to
 * prevent DOM text from being reinterpreted as HTML.
 */
export const isSafeImageSrc = (url: string) => {
    if (!url) return false
    try {
        const lower = url.toLowerCase().trim()
        if (/^https?:\/\/[^ "]+$/i.test(lower)) {
            const path = lower.split("?")[0]
            if (/\.(png|jpe?g|gif|webp)$/i.test(path)) {
                return true
            }
            return false
        }
        if (lower.startsWith("blob:")) return true
        if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(lower)) return true
        return false
    } catch {
        return false
    }
}

/**
 * Converts image data URIs to object URLs for preview while rejecting
 * non-image data URIs entirely.
 */
export const resolveSafeImagePreviewSrc = (src: string) => {
    if (!src) return undefined

    try {
        if (isBase64(src)) {
            return isSafeImageSrc(src) ? dataUriToObjectUrl(src) : undefined
        }

        return isSafeImageSrc(src) ? src : undefined
    } catch {
        return undefined
    }
}
