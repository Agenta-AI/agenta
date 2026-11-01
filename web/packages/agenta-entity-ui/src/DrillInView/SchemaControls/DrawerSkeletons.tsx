/** Loading bodies for the config drawers, passed as `EnhancedDrawer`'s `bodyFallback`. */
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
export function MarkdownEditorSkeleton() {
    return (
        <div
            aria-busy
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-c-BDC7D1)]"
        >
            <div className="flex items-center gap-2 border-0 border-b border-solid border-[var(--ag-c-EAEFF5)] px-3 py-2">
                <SkeletonBlock className="h-5 w-24" />
                <SkeletonBlock className="h-5 w-5" />
                <SkeletonBlock className="h-5 w-5" />
                <SkeletonBlock className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-3 p-4">
                <SkeletonBlock className="h-5 w-2/5" />
                <SkeletonBlock className="h-3" />
                <SkeletonBlock className="h-3" />
                <SkeletonBlock className="h-3 w-3/5" />
                <SkeletonBlock className="mt-3 h-4 w-1/3" />
                <SkeletonBlock className="h-3" />
                <SkeletonBlock className="h-3 w-4/5" />
            </div>
        </div>
    )
}

/** The Files rail beside Name, Description and the SKILL.md editor: the shape of the skill form. */
export function SkillFormSkeleton() {
    return (
        <div aria-busy className="flex h-full min-h-0 gap-4">
            <div className="hidden w-[200px] shrink-0 flex-col gap-3 border-0 border-r border-solid border-colorBorderSecondary pr-3 sm:flex">
                <SkeletonBlock className="h-3 w-12" />
                <SkeletonBlock className="h-7" />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <SkeletonBlock className="h-3 w-16" />
                    <SkeletonBlock className="h-8" />
                </div>
                <div className="flex flex-col gap-2">
                    <SkeletonBlock className="h-3 w-24" />
                    <SkeletonBlock className="h-16" />
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <SkeletonBlock className="h-3 w-20" />
                    <div className="min-h-0 flex-1">
                        <MarkdownEditorSkeleton />
                    </div>
                </div>
            </div>
        </div>
    )
}

/** Account, default permission, search, then tool rows: the shape of a tool's permissions. */
export function ToolPermissionsSkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-3.5 p-4">
            {[0, 1].map((i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <SkeletonBlock className="h-3 w-28" />
                    <SkeletonBlock className="h-9" />
                </div>
            ))}
            <SkeletonBlock className="h-9" />
            <SkeletonRows
                count={6}
                className="rounded border border-solid border-colorBorderSecondary p-3"
                rowClassName="h-9"
            />
        </div>
    )
}
