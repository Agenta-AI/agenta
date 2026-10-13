import {SkeletonBlock} from "@agenta/ui/ui"

/** The template page's frame while the catalog loads. */
export const TemplatePageSkeleton = () => (
    <div aria-busy className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
            <SkeletonBlock active className="h-3 w-56 rounded" />
            <SkeletonBlock active className="mt-5 size-11 rounded-lg" />
            <SkeletonBlock active className="h-8 w-2/3 rounded" />
            <SkeletonBlock active className="h-4 w-full rounded" />
            <SkeletonBlock active className="h-4 w-4/5 rounded" />
            <SkeletonBlock active className="mt-6 h-48 w-full rounded-lg" />
        </div>
        <SkeletonBlock active className="h-72 w-full rounded-lg lg:w-[320px] lg:shrink-0" />
    </div>
)
