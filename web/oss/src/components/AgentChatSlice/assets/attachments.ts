/**
 * Attachment guardrails for the agent composer. Files are sent inline as base64 `data:` URLs
 * (see `files.ts`), so an unbounded picker puts arbitrary bytes straight into the request body.
 * These limits cap the count, per-kind size, and types.
 *
 * NOTE on ceilings: while attachments ride the request body, the real limit is the gateway's
 * `client_max_body_size` (10 MB on the compose stack), and base64 inflates by ~33% on top of the
 * whole resent history. These caps are deliberately per-kind rather than generous. They can rise
 * once attachments travel as references instead of bytes.
 *
 * The limits are a single value object, not scattered constants, so they can be derived from the
 * selected model / harness capabilities and passed down in place of `DEFAULT_ATTACHMENT_LIMITS` —
 * narrowing `kinds` is the seam that capability gating plugs into.
 */

export type AttachmentKind = "image" | "audio" | "document"

/** Media types per kind: exact types (`application/pdf`) or `type/` prefixes (`image/`). */
const KIND_TYPES: Record<AttachmentKind, string[]> = {
    image: ["image/"],
    audio: ["audio/"],
    document: ["application/pdf", "text/", "application/json"],
}

/** `accept` hints for the native picker (a hint only — drag/paste is validated regardless). */
const KIND_ACCEPT_ATTR: Record<AttachmentKind, string> = {
    image: "image/*",
    audio: "audio/*",
    document: "application/pdf,text/plain,text/markdown,text/csv,.md,.csv,application/json",
}

const KIND_NOUN: Record<AttachmentKind, string> = {
    image: "images",
    audio: "audio",
    document: "documents",
}

export interface AttachmentLimits {
    /** Max files per message, across all kinds. */
    maxCount: number
    /** Kinds the composer accepts. Narrowing this is how capability gating plugs in. */
    kinds: AttachmentKind[]
    /** Max bytes per file, per kind (before base64 inflation, which adds ~33% on the wire). */
    maxBytes: Record<AttachmentKind, number>
}

const MB = 1024 * 1024

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
    maxCount: 5,
    kinds: ["image", "audio", "document"],
    maxBytes: {
        // A photo off a phone clears 5 MB routinely.
        image: 10 * MB,
        // Our own recordings cap near 2.4 MB; the headroom is for uploaded clips.
        audio: 15 * MB,
        document: 10 * MB,
    },
}

/** Which kind a media type belongs to, or null when it is not something we take at all. */
export const kindForType = (mediaType: string): AttachmentKind | null => {
    for (const kind of Object.keys(KIND_TYPES) as AttachmentKind[]) {
        const matches = KIND_TYPES[kind].some((t) =>
            t.endsWith("/") ? mediaType.startsWith(t) : mediaType === t,
        )
        if (matches) return kind
    }
    return null
}

/** Whether a media type is allowed under the limits (right kind, and that kind is enabled). */
export const isAcceptedType = (mediaType: string, limits: AttachmentLimits): boolean => {
    const kind = kindForType(mediaType)
    return !!kind && limits.kinds.includes(kind)
}

/** `accept` attribute for the native file picker, built from the enabled kinds. */
export const acceptAttrFor = (limits: AttachmentLimits): string =>
    limits.kinds.map((k) => KIND_ACCEPT_ATTR[k]).join(",")

/** Human summary of what is accepted, e.g. "Images, audio, and documents". */
export const describeAccepted = (limits: AttachmentLimits): string => {
    const nouns = limits.kinds.map((k) => KIND_NOUN[k])
    if (nouns.length === 0) return "No attachments"
    const sentence =
        nouns.length === 1
            ? nouns[0]
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

        if (!kind || !limits.kinds.includes(kind)) {
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
