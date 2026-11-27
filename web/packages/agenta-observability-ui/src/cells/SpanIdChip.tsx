import {Badge, cn} from "@agenta/ui/ui"

/** The inline id tag `getObservabilityColumns` renders in the span column. */
export const SpanIdChip = ({id, className}: {id: string; className?: string}) => (
    <Badge className={cn("font-mono max-w-full truncate align-middle", className)}># {id}</Badge>
)

export default SpanIdChip
