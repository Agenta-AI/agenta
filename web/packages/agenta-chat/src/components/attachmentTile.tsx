/** The square every attachment draws in, staged in the composer or replayed on a message. */
export const ATTACHMENT_TILE =
    "relative box-border size-20 shrink-0 overflow-hidden rounded-lg border border-solid border-border/60 bg-muted"

/** The tile's face: a glyph over the name, centered. */
export const ATTACHMENT_TILE_FACE =
    "absolute inset-0 flex flex-col items-center justify-center gap-1 border-0 bg-transparent p-1.5 text-muted-foreground"

export const AttachmentTileName = ({name}: {name: string}) => (
    <span className="w-full truncate text-center text-[10px] leading-3 text-muted-foreground">
        {name}
    </span>
)
