import {Check} from "lucide-react"

import {cn} from "../lib/utils"

import {AppIcon} from "./AppIcon"

/** One pickable event: its app's mark, its name, and a check when it is the bound one. */
export const EventRow = ({
    label,
    logo,
    logoLoading = false,
    selected,
    onSelect,
}: {
    label: string
    logo?: string | null
    logoLoading?: boolean
    selected: boolean
    onSelect: () => void
}) => (
    <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
            "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2.5 text-left text-[13px] text-foreground hover:bg-muted lg:py-1.5",
            selected && "bg-muted",
        )}
    >
        <AppIcon logo={logo} label={label} loading={logoLoading} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected ? (
            <Check aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
    </button>
)
