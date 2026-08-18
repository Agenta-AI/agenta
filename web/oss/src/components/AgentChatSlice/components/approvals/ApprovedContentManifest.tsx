/**
 * Workspace content a commit is importing, as the approval card shows it.
 *
 * The rule this exists to satisfy: the card never shows only a byte count and a path. A `set`
 * that replaces a field from a file shows a unified diff of what it replaces; every imported
 * file shows its path, size, and digest.
 *
 * The diff is computed by the runner over the exact bytes the approval binds, so it is rendered
 * as-is. `DiffView` from `@agenta/ui` is deliberately not used here: it normalizes content as
 * JSON or YAML, which would mangle a Markdown instructions document.
 */
import {useMemo, useState} from "react"

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

/** Narrow the wire payload; anything malformed renders nothing rather than a partial truth. */
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

const formatBytes = (bytes: number): string =>
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

const DIFF_PREVIEW_LINES = 40

const DiffBlock = ({diff}: {diff: ManifestDiff}) => {
    const [expanded, setExpanded] = useState(false)
    const lines = useMemo(() => diff.diff.split("\n"), [diff.diff])
    const clipped = !expanded && lines.length > DIFF_PREVIEW_LINES
    const shown = clipped ? lines.slice(0, DIFF_PREVIEW_LINES) : lines

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-semibold text-colorText">Replace {diff.targetField}</span>
                <span className="text-colorSuccess">+{diff.addedLines}</span>
                <span className="text-colorError">−{diff.removedLines}</span>
                <span className="text-colorTextTertiary">
                    {formatBytes(diff.oldBytes)} → {formatBytes(diff.newBytes)}
                </span>
            </div>
            <pre className="m-0 max-h-80 overflow-auto rounded border border-solid border-colorBorderSecondary bg-colorBgContainer p-2 text-xs leading-snug">
                {shown.map((line, index) => (
                    <div
                        key={index}
                        className={
                            line.startsWith("+")
                                ? "text-colorSuccess"
                                : line.startsWith("-")
                                  ? "text-colorError"
                                  : line.startsWith("@@")
                                    ? "text-colorTextTertiary"
                                    : "text-colorTextSecondary"
                        }
                    >
                        {line || " "}
                    </div>
                ))}
            </pre>
            {clipped || expanded ? (
                <button
                    type="button"
                    onClick={() => setExpanded((s) => !s)}
                    className="cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-colorTextTertiary transition-colors hover:text-colorText"
                >
                    {expanded ? "Show less" : `Show all ${lines.length} diff lines`}
                </button>
            ) : null}
            {diff.diffTruncated ? (
                <div className="text-xs text-colorTextTertiary">
                    The diff is shortened for display; the counts above cover the whole change.
                </div>
            ) : null}
        </div>
    )
}

const ApprovedContentManifest = ({manifest}: {manifest: ApprovedContentManifestValue}) => (
    <div className="flex min-w-0 flex-col gap-3">
        {manifest.diffs.map((diff, index) => (
            <DiffBlock key={`${diff.targetField}-${index}`} diff={diff} />
        ))}

        {manifest.files.length ? (
            <div className="flex min-w-0 flex-col gap-1">
                <div className="text-xs font-semibold text-colorText">
                    From your workspace ({formatBytes(manifest.totalBytes)})
                </div>
                {manifest.files.map((file) => (
                    <div
                        key={`${file.relativePath}-${file.digest}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-xs text-colorTextSecondary"
                    >
                        <span className="font-mono">{file.relativePath}</span>
                        <span className="text-colorTextTertiary">{formatBytes(file.bytes)}</span>
                        {file.executableBit ? (
                            <span className="text-colorWarning">executable</span>
                        ) : null}
                        {/* Scoped label: this one covers the FILE, the line below covers the whole
                            change, and two bare hexes read as a mismatch. */}
                        <span
                            className="text-colorTextTertiary"
                            title="Digest of this file's contents"
                        >
                            file digest{" "}
                            <span className="font-mono">{file.digest.slice(0, 12)}</span>
                        </span>
                    </div>
                ))}
            </div>
        ) : null}

        {/* Contract: the card must say the digest covers the FULL content, not the shown view. */}
        {manifest.contentDigest ? (
            <div
                className="text-xs text-colorTextTertiary"
                title="Digest over the fully resolved arguments, including every file's bytes"
            >
                Approving commits exactly this content (whole-change digest{" "}
                <span className="font-mono">{manifest.contentDigest.slice(0, 12)}</span>, covering
                the full text, not only what is shown).
            </div>
        ) : null}
    </div>
)

export default ApprovedContentManifest
