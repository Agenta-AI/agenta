import {SkeletonBlock} from "@agenta/ui/ui"

/** The featured card's frame while the catalog loads, so the page does not jump when it lands. */
export const FeaturedTemplateSkeleton = () => (
    <div
        aria-busy
        className="box-border hidden grid-cols-2 items-center gap-6 rounded-lg border border-solid border-border bg-secondary p-5 md:grid lg:gap-8 lg:p-6"
    >
        <div className="flex flex-col gap-3">
            <SkeletonBlock active className="h-3 w-32 rounded-sm" />
            <SkeletonBlock active className="size-8 rounded-md" />
            <SkeletonBlock active className="h-6 w-1/2 rounded-sm" />
            <SkeletonBlock active className="h-4 w-full rounded-sm" />
            <SkeletonBlock active className="h-4 w-4/5 rounded-sm" />
            <SkeletonBlock active className="mt-1 h-8 w-64 rounded-md" />
        </div>
        <SkeletonBlock active className="h-48 w-full rounded-lg" />
    </div>
)
