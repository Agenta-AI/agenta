/** Skeleton parts of a form in its loaded places and heights (STATE-02). */
import type {ReactNode} from "react"

import {cn, SkeletonBlock} from "@agenta/ui/ui"

/** A field's 18px label line over its control (the kit `Field`, gap 4px). */
export const SkeletonField = ({
    label,
    labelEnd = false,
    children,
}: {
    label: string
    /** A 24px link button at the end of the label line ("New secret"). */
    labelEnd?: boolean
    children: ReactNode
}) => (
    <div className="flex flex-col gap-1">
        <div className={cn("flex items-center", labelEnd ? "h-6" : "h-4.5")}>
            <SkeletonBlock className={cn("h-3", label)} />
            {labelEnd ? <SkeletonBlock className="ml-auto h-3 w-20" /> : null}
        </div>
        {children}
    </div>
)

/** The kit `ChoiceSwitch` with two noted choices, as the Owner field draws it. */
export const SkeletonChoiceSwitch = () => (
    <div className="flex h-[74px] gap-0.5 rounded-lg bg-secondary p-0.5">
        {[0, 1].map((i) => (
            <div key={i} className="flex flex-1 flex-col gap-1.5 px-2.5 py-2">
                <SkeletonBlock className="mt-1 h-3 w-16" />
                <SkeletonBlock className="h-2.5 w-4/5" />
                <SkeletonBlock className="h-2.5 w-1/2" />
            </div>
        ))}
    </div>
)
