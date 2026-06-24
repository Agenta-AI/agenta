import {memo} from "react"

import {Tag} from "antd"
import clsx from "clsx"

export interface CategoryTagsProps {
    entries: {label: string; count: number}[]
    maxTags?: number
    className?: string
}

// Color palette for category tags
const TAG_COLORS = ["green", "blue", "purple", "orange", "cyan", "magenta", "gold", "lime"]

const getTagColor = (index: number) => TAG_COLORS[index % TAG_COLORS.length]

/**
 * Displays category frequency data as pill/tag elements.
 * Used for array-type metrics where a bar chart isn't appropriate.
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
                <Tag
                    key={`${entry.label}-${index}`}
                    color={getTagColor(index)}
                    className="m-0 text-xs"
                >
                    {entry.label} ({entry.count})
                </Tag>
            ))}
            {remainingCount > 0 && (
                <Tag className="m-0 text-xs" color="default">
                    +{remainingCount} more
                </Tag>
            )}
        </div>
    )
})

CategoryTags.displayName = "CategoryTags"

export default CategoryTags
