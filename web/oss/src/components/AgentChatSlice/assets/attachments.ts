/**
 * Attachment guardrails for the agent composer. Files are sent inline as base64 `data:` URLs
 * (see `files.ts`), so an unbounded picker puts arbitrary bytes straight into the request body.
 * These limits cap the count, per-file size, and types.
 *
 * The limits are a single value object, not scattered constants, so they can later be derived
 * from the selected model / harness capabilities (e.g. an image-only model, a larger context
 * window) and passed down in place of `DEFAULT_ATTACHMENT_LIMITS`. That wiring is out of scope
 * here; today everything reads the default.
 */

export interface AttachmentLimits {
    /** Max files per message. */
    maxCount: number
    /** Max bytes per file (before base64 inflation, which adds ~33% on the wire). */
    maxBytes: number
    /** Accepted media types: exact types (`application/pdf`) or `type/` prefixes (`image/`). */
    accept: string[]
    /** `accept` attribute for the native file picker (a hint; drag/paste is validated too). */
    acceptAttr: string
    /** Human label for the kinds accepted, e.g. "Images and documents". */
    label: string
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
    maxCount: 5,
    maxBytes: 5 * 1024 * 1024,
    accept: ["image/", "application/pdf", "text/", "application/json"],
    acceptAttr:
        "image/*,application/pdf,text/plain,text/markdown,text/csv,.md,.csv,application/json",
    label: "Images and documents",
}

/** Whether a media type is allowed under the limits (prefix or exact match). */
export const isAcceptedType = (mediaType: string, limits: AttachmentLimits): boolean =>
    limits.accept.some((a) => (a.endsWith("/") ? mediaType.startsWith(a) : mediaType === a))

/** Compact human size: `820 KB`, `4.2 MB`. */
export const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface AttachmentRejection {
    /** The file's name, for the inline message. */
    name: string
    /** Why it was rejected (verb phrase): "is too large (8.2 MB) · max 5 MB". */
    reason: string
}

export interface AttachmentValidation {
    accepted: File[]
    rejections: AttachmentRejection[]
}

/**
 * Validate a batch of incoming files against the limits, given how many are already attached.
 * Returns the files to add (in order, capped to the remaining slots) and a rejection per file
 * that didn't make it. Pure: callers own state and messaging.
 */
export const validateIncoming = (
    incoming: File[],
    currentCount: number,
    limits: AttachmentLimits = DEFAULT_ATTACHMENT_LIMITS,
): AttachmentValidation => {
    const accepted: File[] = []
    const rejections: AttachmentRejection[] = []
    let remaining = limits.maxCount - currentCount

    for (const file of incoming) {
        const type = file.type || "application/octet-stream"
        if (!isAcceptedType(type, limits)) {
            rejections.push({name: file.name, reason: `isn't a supported file type`})
            continue
        }
        if (file.size > limits.maxBytes) {
            rejections.push({
                name: file.name,
                reason: `is too large (${formatBytes(file.size)}) · max ${formatBytes(limits.maxBytes)} per file`,
            })
            continue
        }
        if (remaining <= 0) {
            rejections.push({
                name: file.name,
                reason: `exceeds the ${limits.maxCount}-file limit`,
            })
            continue
        }
        accepted.push(file)
        remaining -= 1
    }

    return {accepted, rejections}
}
