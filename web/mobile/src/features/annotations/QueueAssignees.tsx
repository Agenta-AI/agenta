import {useUserDisplayName} from "@agenta/entities/shared"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Avatar, AvatarFallback, Badge} from "@agenta/ui/ui"

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")

const AssigneeChip = ({userId}: {userId: string}) => {
    const name = useUserDisplayName(userId) ?? userId.slice(0, 8)
    return (
        <Badge variant="default" className="gap-1.5 pl-0.5">
            <Avatar size="small" className="size-5 text-caption">
                <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            {name}
        </Badge>
    )
}

/** Who reviews the queue: two chips, then "+N" with the rest in a tooltip; "—" for nobody. */
export const QueueAssignees = ({assignments}: {assignments: string[][] | null | undefined}) => {
    // One list per review round; a person can be in several rounds but shows once.
    const userIds = Array.from(new Set((assignments ?? []).flat().filter(Boolean)))
    if (userIds.length === 0) return <span className="text-body text-muted-foreground">—</span>
    const shown = userIds.slice(0, 2)
    const rest = userIds.slice(2)
    return (
        <div className="flex flex-wrap items-center gap-1">
            {shown.map((id) => (
                <AssigneeChip key={id} userId={id} />
            ))}
            {rest.length > 0 ? (
                <SimpleTooltip
                    title={
                        <span className="flex flex-col gap-1">
                            {rest.map((id) => (
                                <AssigneeChip key={id} userId={id} />
                            ))}
                        </span>
                    }
                >
                    <Badge variant="default" tabIndex={0}>{`+${rest.length}`}</Badge>
                </SimpleTooltip>
            ) : null}
        </div>
    )
}
