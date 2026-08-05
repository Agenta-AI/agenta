/**
 * DrivePendingTiles — the grid tiles for files that are not (yet) committed drive content: an
 * in-flight upload ({@link UploadTile}) and a file staged awaiting a destination ({@link StagedTile}),
 * both thin adapters over the ONE {@link PendingTile} look. Rendered by {@link FolderView}; the state
 * behind them lives in {@link useDriveUploads}.
 */
import {File as FileIcon, X} from "@phosphor-icons/react"

import {type MountUploadItem} from "./useMountUpload"

/** The ONE grid tile for a pending item (staged or in-flight upload) — a real-file-tile look with a
 * subtle primary tint. `UploadTile`/`StagedTile` are thin adapters that map their item to this. */
type PendingTileState = "staged" | "uploading" | "error" | "done"

const PendingTile = ({
    name,
    previewUrl,
    state,
    percent = 0,
    caption,
    captionTone = "muted",
    onRetry,
    onRemove,
}: {
    name: string
    previewUrl: string | null
    state: PendingTileState
    percent?: number
    caption: string
    captionTone?: "muted" | "error"
    /** Retry action — error state only (a centered pill over the dimmed thumb). */
    onRetry?: () => void
    /** Remove/dismiss — a corner ✕: hover-revealed while staged, always visible on error. */
    onRemove?: () => void
}) => (
    // box-border is REQUIRED: the real file tiles are <button>s (border-box by UA default even with
    // preflight off), but this is a <div> (content-box) — without it the padding+border widen the box
    // past the cell and pb-[75%] computes a taller thumb, overflowing the grid's snapped row. Caption
    // is PLAIN text (a <button> wouldn't inherit font-size); all actions are absolute overlays that
    // can't change tile height. Subtle primary tint marks it as pending vs a committed file.
    <div className="group box-border flex w-full min-w-0 flex-col gap-2 rounded-lg border border-solid border-[var(--ant-color-primary-border)] bg-[var(--ant-color-primary-bg)] p-2">
        {/* Padding-bottom aspect box: height = 75% of width, GUARANTEED, independent of the image
            (aspect-ratio was defeated by the full-size object-URL image). Content is absolute-inner. */}
        <div className="relative w-full overflow-hidden rounded bg-colorFillTertiary pb-[75%]">
            <div className="absolute inset-0 flex items-center justify-center">
                {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={previewUrl}
                        alt={name}
                        className={`h-full w-full object-cover ${state === "error" ? "opacity-40" : ""}`}
                    />
                ) : (
                    <FileIcon size={34} className="text-colorTextTertiary" />
                )}
                {state === "error" && onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="absolute inset-0 m-auto flex h-7 w-[68px] items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.6)] text-[11px] font-medium text-white hover:bg-[rgba(0,0,0,0.8)]"
                    >
                        Retry
                    </button>
                ) : null}
                {state === "uploading" && percent < 100 ? (
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[rgba(0,0,0,0.2)]">
                        <div
                            className="h-full bg-colorPrimary transition-[width] duration-150"
                            style={{width: `${percent}%`}}
                        />
                    </div>
                ) : null}
                {onRemove ? (
                    <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={onRemove}
                        className={`absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-0 bg-[rgba(0,0,0,0.5)] text-white hover:bg-[rgba(0,0,0,0.7)] ${
                            state === "error"
                                ? "transition-colors"
                                : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}
                    >
                        <X size={11} weight="bold" />
                    </button>
                ) : null}
            </div>
        </div>
        <span className="w-full truncate text-center font-mono text-xs" title={name}>
            {name}
        </span>
        <span
            className={`w-full truncate text-center text-[11px] tabular-nums ${captionTone === "error" ? "text-colorError" : "text-colorTextTertiary"}`}
        >
            {caption}
        </span>
    </div>
)

/** In-flight upload tile: maps the upload item to PendingTile (progress / done / retry-on-failure). */
export const UploadTile = ({
    item,
    onRetry,
    onDismiss,
}: {
    item: MountUploadItem
    onRetry?: (id: string) => void
    onDismiss?: (id: string) => void
}) => (
    <PendingTile
        name={item.name}
        previewUrl={item.previewUrl}
        state={item.error ? "error" : item.percent >= 100 ? "done" : "uploading"}
        percent={item.percent}
        caption={
            item.error
                ? "Upload failed"
                : item.percent >= 100
                  ? "Uploaded"
                  : `Uploading ${item.percent}%`
        }
        captionTone={item.error ? "error" : "muted"}
        onRetry={onRetry ? () => onRetry(item.id) : undefined}
        onRemove={onDismiss && item.error ? () => onDismiss(item.id) : undefined}
    />
)

/** A file dropped onto a recents peek and awaiting a destination — shown until it's committed with
 * "Upload here" or removed. */
export interface StagedTileItem {
    id: string
    name: string
    file: File
    /** Object URL for an image preview, else null (icon fallback). Owned by DriveExplorer. */
    previewUrl: string | null
}

export const StagedTile = ({
    item,
    onRemove,
}: {
    item: StagedTileItem
    onRemove?: (id: string) => void
}) => (
    <PendingTile
        name={item.name}
        previewUrl={item.previewUrl}
        state="staged"
        caption="Ready to upload"
        onRemove={onRemove ? () => onRemove(item.id) : undefined}
    />
)
