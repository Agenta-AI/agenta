import {IconTile} from "@agenta/ui/ui"

/** One Share menu row: an icon tile, a title, and a one-line description. */
export const ShareMenuItem = ({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode
    title: string
    description: string
}) => (
    <>
        <IconTile tone="muted" aria-hidden>
            {icon}
        </IconTile>
        <span className="flex min-w-0 flex-col">
            <span>{title}</span>
            <span className="truncate text-xs text-muted-foreground">{description}</span>
        </span>
    </>
)
