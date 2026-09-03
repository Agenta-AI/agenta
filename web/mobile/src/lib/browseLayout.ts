import {getEnv} from "./env"

/**
 * Browse-surface layout (`NEXT_PUBLIC_AGENT_BROWSE_RAIL`) — the SAME flag the desktop reads, so
 * the two surfaces cannot disagree about a decision that was made once.
 *
 * OFF by default: sessions, agents and the templates gallery use the one-row toolbar
 * (#5833/#5846). This app always renders its nav rail, so a filter rail beside it is precisely
 * the second sidebar those PRs removed — the phone is the only viewport where that was ever
 * arguable, and there the toolbar is what fits anyway.
 *
 * Set to "true" for the filter rail, which then behaves as it always did here: the compact bar on
 * a phone, where the rail's stacked facets would be most of the viewport, and the rail beside the
 * results from `lg` up.
 */
export const BROWSE_RAIL_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_BROWSE_RAIL") || "").toLowerCase() === "true"

/** What the shared `@agenta/*-ui` browse components take as their `layout` prop. */
export const BROWSE_LAYOUT: "toolbar" | "rail" = BROWSE_RAIL_MODE ? "rail" : "toolbar"
