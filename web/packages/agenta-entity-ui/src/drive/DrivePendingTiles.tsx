/**
 * DrivePendingTiles — the grid tiles for files that are not (yet) committed drive content: an
 * in-flight upload ({@link UploadTile}) and a file staged awaiting a destination ({@link StagedTile}),
 * both thin adapters over the ONE {@link PendingTile} look. Rendered by {@link FolderView}; the state
 * behind them lives in {@link useDriveUploads}.
 */
import {type StagedTileItem} from "@agenta/entities/drive"
import {type MountUploadItem} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import driveBrowserCatalog from "@agenta/i18n/catalogs/entityUi.driveBrowser"
import {File as FileIcon, X} from "@phosphor-icons/react"

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
}) => {
    const t = useT(driveBrowserCatalog)
    return (
        // box-border is REQUIRED: the real file tiles are <button>s (border-box by UA default even with
        // preflight off), but this is a <div> (content-box) — without it the padding+border widen the box
        // past the cell and pb-[75%] computes a taller thumb, overflowing the grid's snapped row. Caption
        // is PLAIN text (a <button> wouldn't inherit font-size); all actions are absolute overlays that
        // can't change tile height. A quiet fill marks it as pending vs a committed file.
        <div className="group box-border flex w-full min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-secondary p-2">
            {/* Padding-bottom aspect box: height = 75% of width, GUARANTEED, independent of the image
            (aspect-ratio was defeated by the full-size object-URL image). Content is absolute-inner. */}
            <div className="relative w-full overflow-hidden rounded-sm bg-secondary pb-[75%]">
                <div className="absolute inset-0 flex items-center justify-center">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt={name}
                            className={`h-full w-full object-cover ${state === "error" ? "opacity-40" : ""}`}
                        />
                    ) : (
                        <FileIcon size={34} className="text-muted-foreground" />
                    )}
                    {state === "error" && onRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="absolute inset-0 m-auto flex h-7 w-17 cursor-pointer items-center justify-center rounded-md border-0 text-label focus-ring bg-popover/90 text-foreground shadow-overlay hover:bg-[image:linear-gradient(var(--accent),var(--accent))]"
                        >
                            {t("entityUi.driveBrowser.retry")}
                        </button>
                    ) : null}
                    {state === "uploading" && percent < 100 ? (
                        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-accent">
                            <div
                                className="h-full bg-primary transition-[width] duration-150"
                                style={{width: `${percent}%`}}
                            />
                        </div>
                    ) : null}
                    {onRemove ? (
                        <button
                            type="button"
                            aria-label={t("entityUi.driveBrowser.removeName", {name})}
                            onClick={onRemove}
                            className={`absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 focus-ring bg-popover/90 text-foreground shadow-overlay hover:bg-[image:linear-gradient(var(--accent),var(--accent))] ${
                                state === "error"
                                    ? "transition-colors"
                                    : "transition-opacity focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                            }`}
                        >
                            <X size={12} />
                        </button>
                    ) : null}
                </div>
            </div>
            <span className="w-full truncate text-center font-mono text-meta" title={name}>
                {name}
            </span>
            <span
                className={`w-full truncate text-center text-meta tabular-nums ${captionTone === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
                {caption}
            </span>
        </div>
    )
}

/** In-flight upload tile: maps the upload item to PendingTile (progress / done / retry-on-failure). */
export const UploadTile = ({
    item,
    onRetry,
    onDismiss,
}: {
    item: MountUploadItem
    onRetry?: (id: string) => void
    onDismiss?: (id: string) => void
}) => {
    const t = useT(driveBrowserCatalog)
    return (
        <PendingTile
            name={item.name}
            previewUrl={item.previewUrl}
            state={item.error ? "error" : item.percent >= 100 ? "done" : "uploading"}
            percent={item.percent}
            caption={
                item.error
                    ? t("entityUi.driveBrowser.uploadFailed")
                    : item.percent >= 100
                      ? t("entityUi.driveBrowser.uploaded")
                      : t("entityUi.driveBrowser.uploadingPercent", {percent: item.percent})
            }
            captionTone={item.error ? "error" : "muted"}
            onRetry={onRetry ? () => onRetry(item.id) : undefined}
            onRemove={onDismiss && item.error ? () => onDismiss(item.id) : undefined}
        />
    )
}

/** A file dropped onto a recents peek and awaiting a destination — shown until it's committed with
 * "Upload here" or removed. */
export const StagedTile = ({
    item,
    onRemove,
}: {
    item: StagedTileItem
    onRemove?: (id: string) => void
}) => {
    const t = useT(driveBrowserCatalog)
    return (
        <PendingTile
            name={item.name}
            previewUrl={item.previewUrl}
            state="staged"
            caption={t("entityUi.driveBrowser.readyToUpload")}
            onRemove={onRemove ? () => onRemove(item.id) : undefined}
        />
    )
}

export type {StagedTileItem}
