import {Badge, cn} from "@agenta/ui/ui"

/** Marks the method the visitor signed in with last time. */
export const LastUsedBadge = ({className}: {className?: string}) => (
    <Badge
        variant="outlined"
        className={cn(
            "pointer-events-none rounded-full px-2 text-[11px] font-medium leading-4 text-muted-foreground",
            className,
        )}
    >
        Last used
    </Badge>
)
