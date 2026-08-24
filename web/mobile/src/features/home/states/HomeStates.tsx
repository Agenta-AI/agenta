import {Skeleton} from "@/components/ui/skeleton"

export const HomeSectionSkeleton = () => (
    <div className="flex flex-col gap-3 px-4 py-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
    </div>
)

// Left-aligned on purpose: the hint stands in for rows under a left-aligned section header,
// so it keeps the list's reading axis instead of floating mid-column.
export const HomeSectionEmpty = ({text}: {text: string}) => (
    <p className="text-muted-foreground px-4 py-6 text-xs">{text}</p>
)
