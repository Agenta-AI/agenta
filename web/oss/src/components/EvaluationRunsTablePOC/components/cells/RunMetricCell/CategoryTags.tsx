import {memo} from "react"

import {getTagColor} from "@agenta/ui/cell-renderers"
import {Badge} from "@agenta/ui/ui"
import clsx from "clsx"

export interface CategoryTagsProps {
    entries: {label: string; count: number}[]
    maxTags?: number
    className?: string
}

/**
 * Displays category frequency data as pill/tag elements.
 * Used for array-type metrics where a bar chart isn't appropriate.
 *
 * Colours come from the shared `getTagColor` (`@agenta/ui/cell-renderers`); this file used to
 * keep a private copy of the hue list, which drifted from the design-system tag tokens.
 */
const CategoryTags = memo(({entries, maxTags = 3, className}: CategoryTagsProps) => {
    if (!entries.length) {
        return null
    }

    const displayEntries = entries.slice(0, maxTags)
    const remainingCount = entries.length - maxTags

    return (
        <div className={clsx("flex flex-col items-center gap-1", className)}>
            {displayEntries.map((entry, index) => (
                <Badge
                    key={`${entry.label}-${index}`}
                    variant={getTagColor(index)}
                    className="m-0 text-xs"
                >
                    {entry.label} ({entry.count})
                </Badge>
            ))}
            {remainingCount > 0 && (
                <Badge className="m-0 text-xs" variant="default">
                    +{remainingCount} more
                </Badge>
            )}
        </div>
    )
})

CategoryTags.displayName = "CategoryTags"

export default CategoryTags
