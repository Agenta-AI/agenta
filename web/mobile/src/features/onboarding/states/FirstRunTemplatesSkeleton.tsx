import {Skeleton} from "@/components/ui/skeleton"

/**
 * The template strip while the catalogue loads — the card row's own geometry (the monogram
 * headroom, the 62-wide snap cards on a phone, three across at `lg`), so the cards replace it
 * without moving anything. Never an empty strip: that would claim there are no templates.
 */
export const FirstRunTemplatesSkeleton = () => (
    <div
        aria-busy
        className="-mx-4 flex gap-3 overflow-hidden px-4 pb-2 pt-7 lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0"
    >
        {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 w-62 shrink-0 rounded-lg lg:w-auto" />
        ))}
    </div>
)
