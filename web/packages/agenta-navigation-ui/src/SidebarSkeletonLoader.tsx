import {memo} from "react"

import {SkeletonBlock} from "@agenta/ui/ui"
import clsx from "clsx"

const Rows = ({
    count,
    heightClass,
    collapsed,
}: {
    count: number
    heightClass: string
    collapsed: boolean
}) => (
    <div className={clsx("flex w-full flex-col gap-2", collapsed ? "items-center" : "")}>
        {Array.from({length: count}, (_, index) => (
            <SkeletonBlock
                key={index}
                active
                className={clsx(heightClass, collapsed ? "w-[28px]" : "w-full")}
            />
        ))}
    </div>
)

/** The rail while its scope resolves — mirrors the final geometry so nothing shifts. */
export const SidebarSkeletonLoader = memo(({collapsed}: {collapsed: boolean}) => (
    <section
        className={clsx(
            "flex h-screen flex-col justify-between border-0 border-r border-solid border-colorBorderSecondary",
            collapsed ? "w-[48px] items-center" : "w-[236px]",
        )}
    >
        <div className="flex h-full w-full flex-col items-center gap-3 px-2 pt-2">
            <Rows count={1} heightClass="h-7" collapsed={collapsed} />
            <hr className="-mt-1 w-full border-0 border-t border-solid border-colorBorderSecondary" />
            <Rows count={4} heightClass="h-6" collapsed={collapsed} />
        </div>
        <div className="flex w-full flex-col items-center px-2 pb-2">
            <Rows count={3} heightClass="h-6" collapsed={collapsed} />
        </div>
    </section>
))
SidebarSkeletonLoader.displayName = "SidebarSkeletonLoader"
