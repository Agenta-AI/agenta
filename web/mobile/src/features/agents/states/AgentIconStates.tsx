import {LoaderCircle, SearchX, TriangleAlert} from "lucide-react"

import {Button} from "@/components/ui/button"

/**
 * The icon grid's three non-happy states. All three hold the grid's height so the sheet does not
 * resize under a thumb that is already reaching for it.
 */
const BOX = "flex h-64 flex-col items-center justify-center gap-2 px-6 text-center"

export const AgentIconGridLoading = () => (
    <div className={BOX}>
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading icons…</span>
    </div>
)

export const AgentIconGridEmpty = ({query}: {query: string}) => (
    <div className={BOX}>
        <SearchX className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">No icons found</span>
        <span className="max-w-full truncate text-xs text-muted-foreground">
            Nothing matches “{query}”
        </span>
    </div>
)

export const AgentIconGridError = ({onRetry}: {onRetry: () => void}) => (
    <div className={BOX}>
        <TriangleAlert className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Could not load icons</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)
