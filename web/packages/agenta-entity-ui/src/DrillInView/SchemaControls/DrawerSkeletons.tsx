/** Loading bodies for the config drawers, passed as `EnhancedDrawer`'s `bodyFallback`. */
import {SkeletonRows} from "@agenta/ui/composed"
import {cn} from "@agenta/ui/styles"
import {SkeletonBlock} from "@agenta/ui/ui"

/** Label + field pairs: the shape of the item and section forms. */
export function FormDrawerSkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-5">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                    <SkeletonBlock className="h-3 w-28" />
                    <SkeletonBlock className={i === 1 ? "h-24" : "h-8"} />
                </div>
            ))}
        </div>
    )
}

/** The tools as `MarkdownToolbar` draws them: the block menu or H1 to H3, then icon groups. */
export function MarkdownToolbarSkeleton({
    layout = "default",
    className,
}: {
    layout?: "default" | "inline"
    className?: string
}) {
    const inline = layout === "inline"
    const groups = inline ? [3, 4, 3, 2] : [4, 2]
    return (
        <div aria-hidden className={cn("flex items-center gap-1", className)}>
            {inline ? null : <SkeletonBlock className="h-6 w-28 rounded-control" />}
            {groups.map((count, group) => (
                <span key={group} className="flex items-center gap-1">
                    {group > 0 || !inline ? (
                        <span
                            className={cn("h-4 w-px bg-border-muted", inline ? "mx-0.5" : "mx-1")}
                        />
                    ) : null}
                    {Array.from({length: count}).map((_, i) => (
                        <SkeletonBlock
                            key={i}
                            className={cn("rounded-control", inline ? "size-7" : "size-6")}
                        />
                    ))}
                </span>
            ))}
        </div>
    )
}

/** A formatting toolbar over a few lines of text: the shape of the Markdown editor. */
export function MarkdownEditorSkeleton({framed = true}: {framed?: boolean}) {
    if (!framed)
        return (
            // The Instructions view: its muted band (tools, then Source) over the text lines.
            <div aria-busy className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="flex shrink-0 items-center gap-1 bg-muted py-1.5 pl-4 pr-2">
                    <MarkdownToolbarSkeleton className="min-w-0 flex-1" />
                    <SkeletonBlock className="h-6 w-15 shrink-0 rounded-control" />
                </div>
                <MarkdownBodySkeleton />
            </div>
        )
    return (
        <div
            aria-busy
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-solid border-border"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-border-muted px-3 py-2">
                <SkeletonBlock className="h-5 w-24" />
                <SkeletonBlock className="h-5 w-5" />
                <SkeletonBlock className="h-5 w-5" />
                <SkeletonBlock className="h-5 w-5" />
            </div>
            <MarkdownBodySkeleton />
        </div>
    )
}

/** The text lines alone, for a host that draws its own toolbar band. */
export function MarkdownBodySkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-3 p-4">
            <SkeletonBlock className="h-5 w-2/5" />
            <SkeletonBlock className="h-3" />
            <SkeletonBlock className="h-3" />
            <SkeletonBlock className="h-3 w-3/5" />
            <SkeletonBlock className="mt-3 h-4 w-1/3" />
            <SkeletonBlock className="h-3" />
            <SkeletonBlock className="h-3 w-4/5" />
        </div>
    )
}

/** The skill view's fields: Description, then Instructions with its tools over the editor box. */
export function SkillBodySkeleton() {
    return (
        <div aria-busy className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 pt-3">
            <div className="flex flex-col gap-1">
                <div className="flex h-4.5 items-center">
                    <SkeletonBlock className="h-3.5 w-20" />
                </div>
                <SkeletonBlock className="h-19.5 rounded-control" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1">
                <div className="flex h-7 items-center justify-between gap-2">
                    <SkeletonBlock className="h-3.5 w-20" />
                    <MarkdownToolbarSkeleton layout="inline" />
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-control border border-solid border-input">
                    <MarkdownBodySkeleton />
                </div>
            </div>
        </div>
    )
}

/** The registry skill view: the name with its two actions, the usage line, then the fields. */
export function SkillViewSkeleton() {
    return (
        <div aria-busy className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 px-4 py-2">
                <div className="flex h-8 min-w-0 flex-1 items-center">
                    <SkeletonBlock className="h-5 w-40" />
                </div>
                <SkeletonBlock className="size-7 shrink-0 rounded-control" />
                <SkeletonBlock className="size-7 shrink-0 rounded-control" />
            </div>
            <div className="mb-2 flex h-4 shrink-0 items-center px-4">
                <SkeletonBlock className="h-3 w-48" />
            </div>
            <SkillBodySkeleton />
        </div>
    )
}

/** The file button, then Name, Description and the SKILL.md editor: the shape of the skill form. */
export function SkillFormSkeleton() {
    return (
        <div aria-busy className="flex h-full min-h-0 flex-col gap-4">
            <SkeletonBlock className="h-8 w-32" />
            <div className="flex flex-col gap-2">
                <SkeletonBlock className="h-3 w-16" />
                <SkeletonBlock className="h-8" />
            </div>
            <div className="flex flex-col gap-2">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="h-16" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
                <MarkdownEditorSkeleton />
            </div>
        </div>
    )
}

/** A part's heading (`FieldHeading`): the label and its 20 px info button. */
const FieldHeadingSkeleton = ({width}: {width: string}) => (
    <div className="flex h-5 items-center gap-1">
        <SkeletonBlock className={`h-3.5 ${width}`} />
        <span className="flex size-5 items-center justify-center">
            <SkeletonBlock shape="mark" className="size-3.5" />
        </span>
    </div>
)

/** One choice of the account `ChoiceSwitch`: the label over its note. */
const ChoiceSkeleton = ({lines}: {lines: number}) => (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2">
        <div className="flex h-5 items-center">
            <SkeletonBlock className="h-3.5 w-16" />
        </div>
        <div className="flex flex-col">
            {Array.from({length: lines}).map((_, i) => (
                <div key={i} className="flex h-4 items-center">
                    <SkeletonBlock className={`h-3 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
                </div>
            ))}
        </div>
    </div>
)

/** A tool row (row-double): name and description on the left, the 128 px select on the right. */
const ToolRowSkeleton = ({name}: {name: string}) => (
    <div className="flex min-h-row-double items-center gap-3 py-1">
        <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-5 items-center">
                <SkeletonBlock className={`h-3.5 ${name}`} />
            </div>
            <div className="flex h-5 items-center">
                <SkeletonBlock className="h-3 w-4/5" />
            </div>
        </div>
        <SkeletonBlock className="h-control w-32 shrink-0 rounded-control" />
    </div>
)

const ROW_NAMES = ["w-32", "w-40", "w-28", "w-36", "w-32"]

/** The tool groups: a group heading (row-single) over tool rows, as `ToolGroup` draws them. */
export function ToolGroupsSkeleton({rows = ROW_NAMES.length}: {rows?: number}) {
    return (
        <div aria-hidden className="flex flex-col gap-1">
            <div className="flex h-row-single items-center gap-2">
                <SkeletonBlock className="h-3.5 w-16" />
                <SkeletonBlock className="h-3.5 w-4" />
                <SkeletonBlock shape="mark" className="ml-auto size-3" />
            </div>
            <div className="flex flex-col gap-2">
                {ROW_NAMES.slice(0, rows).map((name, i) => (
                    <ToolRowSkeleton key={i} name={name} />
                ))}
            </div>
        </div>
    )
}

/** The permission body: account (a switch, a shared sign-in's line, or none), permission, search, tools. */
export function ToolPermissionsSkeleton({
    account = "switch",
}: {
    account?: "switch" | "line" | "none"
}) {
    return (
        <div
            aria-busy
            // The body's quiet scrollbar keeps its 6 px gutter, so the column has the same width.
            className="ag-scroll-quiet flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4 pl-4 pr-2.5 max-md:pr-4"
        >
            {account === "none" ? null : (
                <div className="flex flex-col gap-2">
                    <FieldHeadingSkeleton width={account === "switch" ? "w-14" : "w-24"} />
                    {account === "switch" ? (
                        <div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
                            <ChoiceSkeleton lines={2} />
                            <ChoiceSkeleton lines={1} />
                        </div>
                    ) : (
                        // The zero-width space gives the line its label height.
                        <div className="flex items-center text-label">
                            {"\u200b"}
                            <SkeletonBlock className="h-3.5 w-32" />
                        </div>
                    )}
                </div>
            )}
            <div className="flex flex-col gap-2">
                <FieldHeadingSkeleton width="w-28" />
                {/* The select's own pending bar, as the body draws it. */}
                <SkeletonRows count={1} rowClassName="h-control rounded-control" />
            </div>
            <SkeletonBlock className="h-control shrink-0 rounded-control" />
            <ToolGroupsSkeleton />
        </div>
    )
}
