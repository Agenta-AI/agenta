import {cn} from "@agenta/ui/styles"

/** antd `Skeleton active paragraph={{rows: 0}}` replacement. */
export const SkeletonBlock = ({className}: {className?: string}) => (
    <div
        className={cn(
            "h-4 w-full max-w-[160px] rounded animate-pulse bg-[var(--ag-colorFillSecondary)]",
            className,
        )}
    />
)
