import {useId} from "react"

/**
 * Ids for one copy of a logo's svg defs (gradient, clip path). With fixed ids, a hidden copy
 * earlier on the page owns the defs and a visible copy paints nothing. Only id-safe characters,
 * because the ids go into `url(#…)` references.
 */
export const useSvgIds = () => {
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, "")
    return {paint: `${id}-paint`, clip: `${id}-clip`}
}
