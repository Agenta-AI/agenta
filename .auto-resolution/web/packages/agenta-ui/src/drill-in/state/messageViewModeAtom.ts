import {atomWithStorage} from "jotai/utils"

import type {ViewMode} from "../utils/getViewOptions"

/**
 * Shared, persisted view mode for chat / prompt message editors.
 *
 * Replaces the per-message local `useState` so that:
 *  - switching one message's view (Text / Markdown / JSON / YAML) switches every
 *    message editor at once, and
 *  - the choice survives a page refresh (persisted to localStorage).
 *
 * Scope note: this is a single app-wide atom, so it is shared by every consumer
 * of the message editors (playground prompt + chat turns, and also the drill-in
 * message fields). The key is intentionally not namespaced to "playground".
 *
 * Defaults to "text" so messages open as plain, raw text.
 */
export const messageViewModeAtom = atomWithStorage<ViewMode>("agenta:message-view-mode", "text")
