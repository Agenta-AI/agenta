/**
 * The card surface used by every panel in Home's right rail.
 *
 * Kept in one place because the rail's cards had drifted into three different shells — different
 * radius, border token, surface token and padding — stacked 24px apart in a single column, which
 * read as three unrelated widgets rather than one rail.
 *
 * `shrink-0` is load-bearing, not decoration. The rail is a flex column with a bounded height,
 * so its cards inherit `flex-shrink: 1` and get compressed when they overflow it — the box
 * closes at the height the rail wants while the rows keep laying out past its bottom border.
 * The rail scrolls; the cards keep their own height.
 */
export const RAIL_CARD_CLASS =
    "shrink-0 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-3"
