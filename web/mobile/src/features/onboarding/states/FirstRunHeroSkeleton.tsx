import {Skeleton} from "@/components/ui/skeleton"

/** The hero's title and subtitle lines while a `?template=` arrival resolves its template. */
export const FirstRunHeroSkeleton = () => (
    <div aria-busy className="flex flex-col gap-2">
        <Skeleton className="h-8 w-2/3 max-w-[420px] lg:h-10" />
        <Skeleton className="h-4 w-full max-w-[560px]" />
    </div>
)
