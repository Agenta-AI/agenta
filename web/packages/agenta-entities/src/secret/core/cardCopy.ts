/**
 * The connection card's model list rules. The card's text is in `@agenta/entity-ui`
 * (`providerCardText.ts`), in the active language.
 *
 * Design: docs/design/provider-connections-models/experience.md ("Provider connection card").
 */

/**
 * How many model rows mount before the list collapses behind "Show all N".
 *
 * This is a DOM budget, not a layout one. The list has its own scroller and the drawer body scrolls
 * behind it, so length costs nothing visually — the only real concern is mounting a few hundred rows
 * for an endpoint that serves them. A typical provider returns 25-40 models, which is the design's
 * normal case and must render whole.
 */
export const MODEL_LIST_RENDER_CAP = 60

/**
 * What the model list renders, and whether "Show all N" belongs under it.
 *
 * The rule the founder fixed: "Show all" may never appear while every row is already on screen. So
 * truncation is decided by the row count ALONE — never by available height — and once the user has
 * asked for the full list it stays asked for.
 */
export const modelListView = ({
    total,
    showAll,
}: {
    total: number
    showAll: boolean
}): {truncated: boolean; visibleCount: number} => {
    const truncated = !showAll && total > MODEL_LIST_RENDER_CAP
    return {truncated, visibleCount: truncated ? MODEL_LIST_RENDER_CAP : total}
}
