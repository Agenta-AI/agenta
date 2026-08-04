import type {MountFile} from "@agenta/entities/session"
import type {CodeLanguage} from "@agenta/ui/editor"

import {driveCodeLanguage, resolveDriveFileKind, TEXT_CAP, type DriveFileKind} from "../driveKinds"

export const EDIT_KINDS = new Set<DriveFileKind>([
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
    | "too-large"
    | "unavailable"

export interface DriveEditAvailabilityInput {
    kind: DriveFileKind
    listingSize: number | null
    contentLength: number | null
    isPending: boolean
    canEdit: boolean
}

export function driveEditAvailability({
    kind,
    listingSize,
    contentLength,
    isPending,
    canEdit,
}: DriveEditAvailabilityInput): DriveEditAvailability {
    if (!canEdit || !EDIT_KINDS.has(kind)) return "unavailable"
    if (listingSize != null && listingSize > TEXT_CAP) return "too-large"
    if (isPending) return "loading"
    if (contentLength == null) return "unreadable"
    if (contentLength > TEXT_CAP) return "too-large"
    return "enabled"
}

export function driveEditBufferMode(path: string): "markdown" | "code" {
    return resolveDriveFileKind(path) === "markdown" ? "markdown" : "code"
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
    if (baseMtime == null || theirMtime == null || baseMtime === theirMtime) return null
    return {reason: "changed", theirMtime}
}
