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
        {/* Same tile as the Publish hub cards, so the menu and the panel read as one. */}
        <span className="box-border flex size-8 flex-none items-center justify-center rounded-lg border border-solid border-border text-foreground">
            {icon}
        </span>
        <span className="flex min-w-0 flex-col">
            <span>{title}</span>
            <span className="truncate text-xs text-muted-foreground">{description}</span>
        </span>
    </>
)
