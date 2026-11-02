/** The square every attachment draws in, staged in the composer or replayed on a message. */
export const ATTACHMENT_TILE =
    "relative box-border size-20 shrink-0 overflow-hidden rounded-lg border border-solid border-border/60 bg-muted"

/** The tile's corner button: shown on hover or keyboard focus where hovering exists; always on touch. */
export const ATTACHMENT_TILE_CORNER =
    "absolute right-1 top-1 z-[1] flex size-5 cursor-pointer items-center justify-center rounded-sm border-0 bg-background/90 p-0 text-muted-foreground shadow-sm transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 motion-reduce:transition-none [&_svg]:shrink-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/attachment:opacity-100 [@media(hover:hover)]:group-has-[:focus-visible]/attachment:opacity-100"

/** The tile's face: a glyph over the name, centered. */
export const ATTACHMENT_TILE_FACE =
    "absolute inset-0 flex flex-col items-center justify-center gap-1 border-0 bg-transparent p-1.5 text-muted-foreground"

export const AttachmentTileName = ({name}: {name: string}) => (
    <span className="w-full truncate text-center text-[10px] leading-3 text-muted-foreground">
        {name}
    </span>
)
