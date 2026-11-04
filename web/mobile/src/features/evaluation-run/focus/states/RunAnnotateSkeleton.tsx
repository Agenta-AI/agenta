import {SkeletonBlock} from "@agenta/ui/ui"

/** The Annotate tab while its scenarios load: the navigator over the content and the form. */
export const RunAnnotateSkeleton = () => (
    <div aria-busy="true" aria-label="Loading scenarios..." className="flex flex-col gap-3">
        <SkeletonBlock active className="h-8 w-full rounded-md md:w-[420px]" />
        <div className="flex flex-col gap-3 md:flex-row md:gap-4">
            <SkeletonBlock active className="h-64 w-full rounded-lg md:flex-1" />
            <SkeletonBlock active className="h-64 w-full rounded-lg md:w-[340px] lg:w-[400px]" />
        </div>
    </div>
)
