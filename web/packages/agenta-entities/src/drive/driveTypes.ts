/** Shared drive-surface types: what a drawer is inspecting and which raw ids it can surface. */

/** The drive being inspected: the conversation drive (session) or the app/agent drive (app). */
export type DriveScope = "session" | "app"

/** A raw id surfaced behind the header's overflow menu (a copy affordance, not a label) — the
 * drive/mount id the drawer is about, plus the session/agent it belongs to. */
export interface DriveId {
    key: string
    label: string
    value: string
}

/** A file staged for upload but not yet committed to the drive. */
export interface StagedTileItem {
    id: string
    name: string
    file: File
    /** Object URL for an image preview, else null (icon fallback). Owned by DriveExplorer. */
    previewUrl: string | null
}
