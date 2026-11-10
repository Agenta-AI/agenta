import {compareColor} from "../compareColor"

/** The run a scenario row belongs to: its color and its name. */
export const CompareRowRun = ({slot, name}: {slot: number; name: string}) => (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
        <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{backgroundColor: compareColor(slot)}}
        />
        <span className="truncate">{name}</span>
    </span>
)
