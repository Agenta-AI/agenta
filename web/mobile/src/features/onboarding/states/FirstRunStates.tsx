import {Skeleton} from "@/components/ui/skeleton"

/**
 * The hold while we do not yet know whether this project has agents.
 *
 * Deliberately shaped from the parts BOTH outcomes share — a page title, then one composer-height
 * block — because it resolves into either the first-run hero or Home, and a skeleton drawn for one
 * of them would shift into the other.
 */
export const FirstRunLoading = () => (
    <div className="flex flex-col gap-6 px-4 pb-6 lg:px-16 lg:pt-14">
        <Skeleton className="h-7 w-2/3 max-w-[320px]" />
        <Skeleton className="h-4 w-full max-w-[420px]" />
        <Skeleton className="h-24 w-full rounded-lg" />
    </div>
)
