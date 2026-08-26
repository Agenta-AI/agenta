import type {KeyEventLike, MatchContext, ShortcutDefinition} from "@agenta/shared/keyboard"
import {matchesShortcut} from "@agenta/shared/keyboard"

/**
 * Is focus somewhere a keystroke means text rather than a command?
 *
 * The union of what the app's own handlers each checked separately, plus one escape hatch:
 * `data-shortcuts="ignore"` on any ancestor opts a subtree out.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
    if (target.isContentEditable) return true
    const role = target.getAttribute("role")
    if (role === "textbox" || role === "combobox") return true
    return Boolean(target.closest('[data-shortcuts="ignore"]'))
}

/**
 * Does a modal or dialog own the screen?
 *
 * There is no global open-dialog state to ask, and these come from `modal.confirm`, so the DOM
 * is the only witness. Deliberately narrow: an antd `Drawer` renders `.ant-drawer-*` and does
 * NOT match, which is what lets the drawer's own agent panel keep its shortcuts.
 */
export const isOverlayOpen = (doc: Document = document): boolean =>
    Boolean(
        doc.querySelector(
            '.ant-modal-wrap:not([style*="display: none"]), [role="dialog"][data-state="open"]',
        ),
    )

/** Reads the browser-side half of a match context off the event itself. */
export const readMatchContext = (
    event: KeyEventLike & {target?: EventTarget | null},
    isMac: boolean,
): MatchContext => ({isMac, typingTarget: isTypingTarget(event.target ?? null)})

/** `matchesShortcut`, with the typing target read from the DOM rather than passed in. */
export const matchesEvent = (
    def: ShortcutDefinition,
    event: KeyEventLike & {target?: EventTarget | null},
    isMac: boolean,
): boolean => matchesShortcut(def, event, readMatchContext(event, isMac))
