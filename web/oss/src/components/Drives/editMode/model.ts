import type {MountFile} from "@agenta/entities/session"
import type {CodeLanguage} from "@agenta/ui/editor"

import {driveCodeLanguage, resolveDriveFileKind, TEXT_CAP, type DriveFileKind} from "../driveKinds"

export const EDIT_KINDS: ReadonlySet<DriveFileKind> = new Set([
    "markdown",
    "text",
    "code",
    "json",
    "csv",
    "html",
])

export type DriveEditAvailability =
    | "enabled"
    | "loading"
    | "unreadable"
    | "listing-unavailable"
    | "too-large"
    | "unavailable"

export interface DriveEditAvailabilityInput {
    kind: DriveFileKind
    listingSize: number | null
    contentByteLength: number | null
    isPending: boolean
    isFetching: boolean
    canEdit: boolean
}

export function driveEditAvailability({
    kind,
    listingSize,
    contentByteLength,
    isPending,
    isFetching,
    canEdit,
}: DriveEditAvailabilityInput): DriveEditAvailability {
    if (!canEdit || !EDIT_KINDS.has(kind)) return "unavailable"
    if (listingSize != null && listingSize > TEXT_CAP) return "too-large"
    if (isPending || isFetching) return "loading"
    if (contentByteLength == null) return "unreadable"
    if (contentByteLength > TEXT_CAP) return "too-large"
    return "enabled"
}

export function supportsMarkdownPreview(path: string): boolean {
    return resolveDriveFileKind(path) === "markdown"
}

export function utf8ByteLength(content: string): number {
    return new TextEncoder().encode(content).length
}

export function driveEditorLanguage(path: string): CodeLanguage {
    switch (driveCodeLanguage(path)) {
        case "json":
            return "json"
        case "yaml":
            return "yaml"
        case "python":
            return "python"
        case "javascript":
        case "jsx":
        case "mjs":
            return "javascript"
        case "typescript":
        case "tsx":
            return "typescript"
        default:
            return "code"
    }
}

export function isEditDirty(original: string, draft: string): boolean {
    return draft !== original
}

export interface DriveEditConflict {
    reason: "changed" | "missing"
    theirMtime: number | null
}

export function conflictFromListing(
    listing: readonly MountFile[],
    path: string,
    baseMtime: number | null,
): DriveEditConflict | null {
    const entry = listing.find((file) => file.path === path)
    if (!entry) return {reason: "missing", theirMtime: null}
    const theirMtime = entry.mtime ?? null
    if (baseMtime == null) {
        return theirMtime == null ? null : {reason: "changed", theirMtime}
    }
    if (theirMtime == null || baseMtime === theirMtime) return null
    return {reason: "changed", theirMtime}
}
