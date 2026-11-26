/** Loading bodies for the config drawers, passed as `EnhancedDrawer`'s `bodyFallback`. */
import {cn} from "@agenta/ui/styles"
import {SkeletonBlock, SkeletonRows} from "@agenta/ui/ui"

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

/** A formatting toolbar over a few lines of text: the shape of the Markdown editor. */
export function MarkdownEditorSkeleton({framed = true}: {framed?: boolean}) {
    return (
        <div
            aria-busy
            className={cn(
                "flex h-full min-h-0 flex-col overflow-hidden",
                framed && "rounded-md border border-solid border-border",
            )}
        >
            {/* Unframed: the edge-to-edge band of a pane editor (Instructions). */}
            <div
                className={cn(
                    "flex items-center gap-2 py-2",
                    framed
                        ? "border-0 border-b border-solid border-border-muted px-3"
                        : "bg-muted pl-4 pr-2",
                )}
            >
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
        {Array.from({length: lines}).map((_, i) => (
            <div key={i} className="flex h-4 items-center">
                <SkeletonBlock className={`h-3 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
            </div>
        ))}
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
        <SkeletonBlock shape="soft" className="h-control w-32 shrink-0" />
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

/**
 * The permission body (`PermissionDrawerBody`): account, default permission, search, tool groups.
 * `title` adds the item view's title line above it: the name, or the MCP server's name and host.
 */
export function ToolPermissionsSkeleton({title}: {title?: "name" | "nameAndHost"}) {
    return (
        <div role="status" aria-busy aria-label="Loading" className="flex min-h-0 flex-1 flex-col">
            {title ? (
                <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                    <SkeletonBlock shape="mark" className="size-6 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex h-5 items-center">
                            <SkeletonBlock className="h-3.5 w-28" />
                        </div>
                        {title === "nameAndHost" ? (
                            <div className="flex h-4 items-center">
                                <SkeletonBlock className="h-3 w-36" />
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4 pl-4 pr-2.5 max-md:pr-4">
                <div className="flex flex-col gap-2">
                    <FieldHeadingSkeleton width="w-14" />
                    <div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
                        <ChoiceSkeleton lines={2} />
                        <ChoiceSkeleton lines={1} />
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <FieldHeadingSkeleton width="w-28" />
                    {/* The select's own pending bar, as the body draws it. */}
                    <SkeletonRows count={1} rowClassName="h-control" />
                </div>
                <SkeletonBlock shape="soft" className="h-control shrink-0" />
                <ToolGroupsSkeleton />
            </div>
        </div>
    )
}
