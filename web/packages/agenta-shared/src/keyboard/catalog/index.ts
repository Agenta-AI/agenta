import type {ShortcutDefinition} from "../types"

import {AGENT_GATE_SHORTCUTS} from "./agentGates"
import {COMPOSER_SHORTCUTS} from "./composer"
import {SESSION_SHORTCUTS} from "./session"
import {SLASH_COMMAND_SHORTCUTS} from "./slashCommands"
import {CONFIG_PANEL_SHORTCUTS, SURFACE_SHORTCUTS} from "./surfaces"

/**
 * Every keyboard shortcut the agent interface answers.
 *
 * A static const, not a registration store: a store only knows about shortcuts whose component
 * happens to be mounted, which is exactly wrong for a reference that must list what the user has
 * not discovered yet. (`@agenta/shared` is `sideEffects: false`, so a bare registration import
 * would be tree-shaken away regardless.)
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
    ...SESSION_SHORTCUTS,
    ...COMPOSER_SHORTCUTS,
    ...SLASH_COMMAND_SHORTCUTS,
    ...AGENT_GATE_SHORTCUTS,
    ...SURFACE_SHORTCUTS,
    ...CONFIG_PANEL_SHORTCUTS,
]

export {MAX_DIGIT_ROWS} from "./agentGates"
export {SESSION_SHORTCUT_MAX} from "./session"
