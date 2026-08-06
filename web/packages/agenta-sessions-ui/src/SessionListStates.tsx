import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {MagnifyingGlassIcon, WarningCircleIcon} from "@phosphor-icons/react"

/** Mirrors a row's geometry so real rows replace it without shifting the list. */
export const SessionListSkeleton = ({rows = 8}: {rows?: number}) => (
    <div aria-busy="true" aria-label="Loading sessions">
        {Array.from({length: rows}, (_, index) => (
            <div
                key={index}
                className="flex items-center gap-3 px-3 py-2 border-solid border-0 border-b border-colorBorderSecondary"
            >
                <span className="shrink-0 w-2 h-2 rounded-full bg-colorFillSecondary" />
                <SkeletonBlock active className="h-4 min-w-0 flex-1" />
                <SkeletonBlock active className="h-4 w-40 flex-none" />
                <SkeletonBlock active className="h-4 w-24 flex-none" />
            </div>
        ))}
    </div>
)

export const SessionListEmpty = ({
    filtered,
    onClearFilters,
}: {
    filtered: boolean
    onClearFilters: () => void
}) => (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <MagnifyingGlassIcon size={24} className="text-colorTextQuaternary" />
        <p className="m-0 text-xs text-colorTextSecondary">
            {filtered ? "No sessions match these filters." : "No sessions yet."}
        </p>
        {filtered ? (
            <Button variant="link" onClick={onClearFilters}>
                Clear filters
            </Button>
        ) : (
            <p className="m-0 text-xs text-colorTextTertiary">
                Start a conversation with an agent and it will show up here.
            </p>
        )}
    </div>
)

export const SessionListError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <WarningCircleIcon size={24} className="text-colorError" />
        <p className="m-0 text-xs text-colorTextSecondary">Couldn&apos;t load your sessions.</p>
        <Button variant="outline" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

/** One group's pager. Each group loads its own next page, in place. */
export const SessionListLoadMore = ({
    loading,
    onClick,
}: {
    loading: boolean
    onClick: () => void
}) => (
    <div className="flex justify-center py-3">
        <Button variant="outline" disabled={loading} onClick={onClick}>
            {loading ? "Loading…" : "Load more"}
        </Button>
    </div>
)

/** A list group's heading. Plain (non-motion) so `sticky` is never fighting a transform. */
export const SessionGroupHeader = ({label}: {label: string}) => (
    <div className="sticky top-0 z-20 -mx-6 bg-colorBgContainer px-6 pb-1 pt-4">
        <p className="m-0 rounded bg-colorBgElevated px-3 py-1 text-xs text-colorTextTertiary">
            {label}
        </p>
    </div>
)
