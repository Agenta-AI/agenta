/**
 * The card surface used by every panel in Home's right rail.
 *
 * Kept in one place because the rail's cards had drifted into three different shells — different
 * radius, border token, surface token and padding — stacked 24px apart in a single column, which
 * read as three unrelated widgets rather than one rail.
 */
export const RAIL_CARD_CLASS =
    "rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-3"
