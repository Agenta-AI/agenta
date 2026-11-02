/**
 * The `/` command palette's slice of the generic palette contract in `./palette`.
 *
 * The composer is generic — a host supplies its own sections (the playground chat gives `/model`
 * and the agent's tools and skills). Only the trigger and its run pattern live here; matching,
 * filtering and the item shape are shared with the `@` file palette.
 */
import {readRun, runPatternFor} from "./palette"

export type {PaletteItemKind as SlashCommandKind} from "./palette"
export type {PaletteItem as SlashCommandItem} from "./palette"
export type {PaletteSection as SlashCommandSection} from "./palette"
export type {PaletteRun as CommandRun} from "./palette"
export type {LabelMatch} from "./palette"

export {filterSections, flattenSections, isSameRun, matchLabel, runFollowsBoundary} from "./palette"

/** A command run: a `/` opening the block or following a space, plus the word being typed. */
export const COMMAND_RUN = runPatternFor("/", false)

/**
 * The command run ending at the caret, or null when there is none. Requiring a space (or the very
 * start) before the `/` is what keeps `and/or`, URLs, and paths from opening the menu mid-sentence.
 */
export const readCommandRun = (textUpToCaret: string) => readRun(textUpToCaret, COMMAND_RUN)
