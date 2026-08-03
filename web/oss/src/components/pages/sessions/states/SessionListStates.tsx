import {MagnifyingGlassIcon, WarningCircleIcon} from "@phosphor-icons/react"
import {Button, Skeleton} from "antd"

/** Mirrors a row's geometry so real rows replace it without shifting the list. */
export const SessionListSkeleton = ({rows = 8}: {rows?: number}) => (
    <div aria-busy="true" aria-label="Loading sessions">
        {Array.from({length: rows}, (_, index) => (
            <div
                key={index}
                className="flex items-center gap-3 px-3 py-2 border-solid border-0 border-b border-colorBorderSecondary"
            >
                <span className="shrink-0 w-2 h-2 rounded-full bg-colorFillSecondary" />
                <Skeleton.Input active className="!h-4 !min-w-0 flex-1" />
                <Skeleton.Input active className="!h-4 !w-40 shrink-0" />
                <Skeleton.Input active className="!h-4 !w-24 shrink-0" />
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
            <Button type="link" onClick={onClearFilters}>
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
        <Button onClick={onRetry}>Try again</Button>
    </div>
)
