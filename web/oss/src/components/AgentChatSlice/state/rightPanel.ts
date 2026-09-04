import {AGENT_CONFIG_WIDTH, CHAT_MIN, FILES_PANE_MIN} from "@agenta/chat/state"
import {SIDEBAR_DEFAULT_WIDTH} from "@agenta/navigation"

/**
 * The chat's right-split geometry now lives in `@agenta/chat/state` (`panelLayout.ts`), so `/m`
 * drives its panes with the same widths and bounds — import the atoms and constants from there.
 * What is left here is the one number that needs the nav sidebar's width to derive.
 */

/** Divider hairlines + panel edge paddings between the four regions. */
const SEAM_SLACK = 25

/** Window width at which config pane + transcript + Files pane all fit at fair widths (with the
 * nav sidebar assumed open at its default). Below it the two side panes are mutually exclusive;
 * at or above it they may stay open together. */
export const PANES_COEXIST_MIN_WINDOW =
    SIDEBAR_DEFAULT_WIDTH + AGENT_CONFIG_WIDTH + CHAT_MIN + FILES_PANE_MIN + SEAM_SLACK
