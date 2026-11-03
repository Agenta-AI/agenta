/**
 * The workspace content a commit imports, parsed off the wire.
 *
 * The card used to render this as a unified diff, a file list with byte counts, and a content
 * digest. It no longer does — the describer turns each entry into one readable row — so this is
 * now only the parser and its shape.
 */
interface ManifestFile {
    relativePath: string
    requestedPath: string
    bytes: number
    digest: string
    executableBit: boolean
}

interface ManifestDiff {
    targetField: string
    baseRevisionId: string
    oldBytes: number
    newBytes: number
    diff: string
    addedLines: number
    removedLines: number
    diffTruncated: boolean
}

export interface ApprovedContentManifestValue {
    files: ManifestFile[]
    diffs: ManifestDiff[]
    totalBytes: number
    contentDigest: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** Narrow the wire payload; anything malformed parses to null rather than a partial truth. */
export const parseApprovedContentManifest = (
    value: unknown,
): ApprovedContentManifestValue | null => {
    if (!isRecord(value)) return null
    const files = Array.isArray(value.files) ? (value.files as ManifestFile[]) : []
    const diffs = Array.isArray(value.diffs) ? (value.diffs as ManifestDiff[]) : []
    if (files.length === 0 && diffs.length === 0) return null
    return {
        files,
        diffs,
        totalBytes: typeof value.totalBytes === "number" ? value.totalBytes : 0,
        contentDigest: typeof value.contentDigest === "string" ? value.contentDigest : "",
    }
}
