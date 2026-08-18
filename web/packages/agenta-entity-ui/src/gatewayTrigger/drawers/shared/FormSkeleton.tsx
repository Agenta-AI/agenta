/** Loading placeholders shaped like the trigger drawers' own field stacks. */
import {cn, SkeletonBlock} from "@agenta/ui/ui"

// ---------------------------------------------------------------------------
// Every box here mirrors a measured height from the loaded form, so the drawer doesn't
// reflow when the data lands: caption box 18px, field control 30px, `Labelled` gap 8px,
// stack gap 20px, body padding 20/24, footer 52px with 28px buttons.
// ---------------------------------------------------------------------------

/** A caption bar inside the 18px box a `text-xs` label occupies. */
function SkeletonLine({width, box = "h-[18px]"}: {width: string; box?: string}) {
    return (
        <div className={cn("flex items-center", box)}>
            <SkeletonBlock active className={cn("h-3.5", width)} />
        </div>
    )
}

/** One `Labelled` field: caption, then its control (or a custom body). */
function SkeletonField({labelWidth, children}: {labelWidth: string; children?: React.ReactNode}) {
    return (
        <div className="flex flex-col gap-2">
            <SkeletonLine width={labelWidth} />
            {children ?? <SkeletonBlock active shape="round" className="h-[30px] w-full" />}
        </div>
    )
}

/** The Advanced disclosure row: top border, 12px padding either side of a 18px caption. */
function SkeletonAdvanced() {
    return (
        // box-border: preflight is off, so without it the 1px border would add to the 43px.
        <div className="box-border flex h-[43px] items-center border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)]">
            <SkeletonBlock active className="h-3.5 w-20" />
        </div>
    )
}

/** Cancel + Save, so the footer doesn't pop in when loading finishes. */
function SkeletonFooter() {
    return (
        <div className="box-border flex shrink-0 items-center justify-end gap-2 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-6 py-3">
            <SkeletonBlock active shape="round" className="h-7 w-[78px]" />
            <SkeletonBlock active shape="round" className="h-7 w-16" />
        </div>
    )
}

function SkeletonBody({children}: {children: React.ReactNode}) {
    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden" aria-hidden>
            <div className="flex flex-1 flex-col gap-5 px-6 py-5">{children}</div>
            <SkeletonFooter />
        </div>
    )
}

/** Name, [Agent], Schedule (+ next-run hint), Message (+ hint), Advanced. */
export function ScheduleFormSkeleton({showAgent}: {showAgent: boolean}) {
    return (
        <SkeletonBody>
            <SkeletonField labelWidth="w-12" />
            {showAgent ? <SkeletonField labelWidth="w-12" /> : null}
            <SkeletonField labelWidth="w-16">
                {/* 30px control + 4px gap + the "Next run …" line. */}
                <div className="flex flex-col gap-1">
                    <SkeletonBlock active shape="round" className="h-[30px] w-full" />
                    <SkeletonLine width="w-56" box="h-5" />
                </div>
            </SkeletonField>
            <SkeletonField labelWidth="w-14">
                {/* 70px textarea + 6px gap + the "Sent to the agent …" line. */}
                <div className="flex flex-col gap-1.5">
                    <SkeletonBlock active shape="round" className="h-[70px] w-full" />
                    <SkeletonLine width="w-64" />
                </div>
            </SkeletonField>
            <SkeletonAdvanced />
        </SkeletonBody>
    )
}

/** Name, [Agent], Trigger, What the agent gets (description + composer + field row), Advanced. */
export function SubscriptionFormSkeleton({showAgent}: {showAgent: boolean}) {
    return (
        <SkeletonBody>
            <SkeletonField labelWidth="w-12" />
            {showAgent ? <SkeletonField labelWidth="w-12" /> : null}
            <SkeletonField labelWidth="w-14" />
            <SkeletonField labelWidth="w-32">
                <div className="flex flex-col gap-2">
                    {/* Description line + "Test event", then the 120px composer, then the
                        Event fields / View as JSON row. */}
                    <div className="flex items-center justify-between">
                        <SkeletonLine width="w-48" />
                        <SkeletonLine width="w-20" />
                    </div>
                    <SkeletonBlock active shape="round" className="h-[120px] w-full" />
                    <div className="flex items-center justify-between">
                        <SkeletonLine width="w-24" />
                        <SkeletonLine width="w-20" />
                    </div>
                </div>
            </SkeletonField>
            <SkeletonAdvanced />
        </SkeletonBody>
    )
}
