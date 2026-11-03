import {Chip} from "../primitives/Chip"

/** The inline id tag `getObservabilityColumns` renders in the span column. */
export const SpanIdChip = ({id, className}: {id: string; className?: string}) => (
    <Chip className={`font-mono max-w-full truncate align-middle ${className ?? ""}`}># {id}</Chip>
)

export default SpanIdChip
