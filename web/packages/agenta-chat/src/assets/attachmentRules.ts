// Canonical since the desktop re-plumb: the OSS copy (assets/attachments.ts) is deleted and
// both apps import this. Named attachmentRules.ts because src/model/attachments.ts already
// holds the `PendingAttachment` staged-file type.
/** Attachment guardrails for files staged in the agent composer (uploads or inline sends). */

export type AttachmentKind = "image" | "audio" | "document" | "other"

/** Media types per kind: exact types (`application/pdf`) or `type/` prefixes (`image/`). */
const KIND_TYPES: Record<AttachmentKind, string[]> = {
    image: ["image/"],
    audio: ["audio/"],
    document: ["application/pdf", "text/", "application/json"],
    other: [],
}

/** `accept` hints for the native picker (a hint only — drag/paste is validated regardless). */
const KIND_ACCEPT_ATTR: Record<AttachmentKind, string> = {
    image: "image/*",
    audio: "audio/*",
    document: "application/pdf,text/plain,text/markdown,text/csv,.md,.csv,application/json",
    other: "",
}

const KIND_NOUN: Record<AttachmentKind, string> = {
    image: "images",
    audio: "audio",
    document: "documents",
    other: "other files",
}

export interface AttachmentLimits {
    /** Max files per message, across all kinds. */
    maxCount: number
    /** Kinds the composer accepts. Narrowing this is how capability gating plugs in. */
    kinds: AttachmentKind[]
    /** Max bytes per file, per kind. */
    maxBytes: Record<AttachmentKind, number>
}

const MB = 1024 * 1024

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
    maxCount: 100,
    kinds: ["image", "audio", "document", "other"],
    maxBytes: {
        // A photo off a phone clears 5 MB routinely.
        image: 10 * MB,
        // Our own recordings cap near 2.4 MB; the headroom is for uploaded clips.
        audio: 15 * MB,
        document: 10 * MB,
        other: 10 * MB,
    },
}

/** Which kind a media type belongs to. */
export const kindForType = (mediaType: string): AttachmentKind => {
    for (const kind of ["image", "audio", "document"] as const) {
        const matches = KIND_TYPES[kind].some((t) =>
            t.endsWith("/") ? mediaType.startsWith(t) : mediaType === t,
        )
        if (matches) return kind
    }
    return "other"
}

/** Whether a media type is allowed under the limits (right kind, and that kind is enabled). */
export const isAcceptedType = (mediaType: string, limits: AttachmentLimits): boolean => {
    const kind = kindForType(mediaType)
    return limits.kinds.includes(kind)
}

/** `accept` attribute for the native file picker, built from the enabled kinds. */
export const acceptAttrFor = (limits: AttachmentLimits): string =>
    limits.kinds.includes("other") ? "" : limits.kinds.map((k) => KIND_ACCEPT_ATTR[k]).join(",")

/** Human summary of what is accepted, e.g. "Images, audio, and documents". */
export const describeAccepted = (limits: AttachmentLimits): string => {
    const nouns = limits.kinds.map((k) => KIND_NOUN[k])
    if (nouns.length === 0) return "No attachments"
    // Two items take a bare "and"; the serial comma only belongs to lists of three or more.
    // (This is user-visible — the composer's empty state renders it.)
    const sentence =
        nouns.length === 1
            ? nouns[0]
            : nouns.length === 2
              ? `${nouns[0]} and ${nouns[1]}`
              : `${nouns.slice(0, -1).join(", ")}, and ${nouns[nouns.length - 1]}`
    return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Compact human size: `820 KB`, `4.2 MB`. */
export const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface AttachmentRejection {
    /** The file's name, for the inline message. */
    name: string
    /** Why it was rejected (verb phrase): "is too large (8.2 MB) · max 10 MB for images". */
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
        const kind = kindForType(type)

        if (!limits.kinds.includes(kind)) {
            rejections.push({name: file.name, reason: "isn't a supported file type"})
            continue
        }
        const maxBytes = limits.maxBytes[kind]
        if (file.size > maxBytes) {
            rejections.push({
                name: file.name,
                reason: `is too large (${formatBytes(file.size)}) · max ${formatBytes(maxBytes)} for ${KIND_NOUN[kind]}`,
            })
            continue
        }
        if (remaining <= 0) {
            rejections.push({name: file.name, reason: `exceeds the ${limits.maxCount}-file limit`})
            continue
        }
        accepted.push(file)
        remaining -= 1
    }

    return {accepted, rejections}
}

/** A file kind an attachment viewer can preview; audio plays inline in the tray instead. */
export const isViewable = (mediaType: string): boolean =>
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/") ||
    mediaType === "application/json"
