import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * When true the agent chat panel is maximized: the config panel collapses to 0 and the session
 * rail takes its place. This is the single source of truth for the playground's Build/Chat mode —
 * the header switch writes it, and the layout, the config pane and the chat panel all read it.
 *
 * Persisted: which of the two modes you work in is a standing preference, and resetting it on
 * every reload put chat users back in the build layout they had already left.
 */
export const chatPanelMaximizedAtom = atomWithStorage("agenta:chat:panel-maximized", false)

/**
 * Below this width the config pane and the transcript cannot share the screen: the pane alone
 * asks for 300-440px and the transcript for 420px more. A phone therefore shows the config pane
 * and nothing else, which is not where a chat starts. The number is antd's `md` breakpoint, the
 * same "too small for the desktop layout" line `NoMobilePageWrapper` already draws.
 */
export const PHONE_VIEWPORT_QUERY = "(max-width: 767.98px)"

const readPhoneViewport = (): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return false
    return window.matchMedia(PHONE_VIEWPORT_QUERY).matches
}

/**
 * Live "the window is phone-width" flag. Seeded at module load rather than on mount so the first
 * paint of the playground is already correct — the playground is a client-only chunk, so there is
 * no server render to disagree with, and a mount-time read would flash the config pane first.
 */
export const phoneViewportAtom = atom(readPhoneViewport())
phoneViewportAtom.onMount = (set) => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const list = window.matchMedia(PHONE_VIEWPORT_QUERY)
    set(list.matches)
    const sync = (event: MediaQueryListEvent) => set(event.matches)
    list.addEventListener("change", sync)
    return () => list.removeEventListener("change", sync)
}

/**
 * The stored answer to "did the user collapse the config pane?", or `null` when the user has never
 * touched either control. The tri-state is what makes a per-device default possible: a plain
 * `false` default cannot tell "I want the config pane" apart from "I have never said".
 *
 * `getOnInit` reads localStorage synchronously, so a stored preference applies to the first paint
 * instead of arriving one render later.
 */
export const configPanelCollapsedPreferenceAtom = atomWithStorage<boolean | null>(
    "agenta:chat:config-panel-collapsed",
    null,
    undefined,
    {getOnInit: true},
)

/**
 * The same answer asked separately at phone width (#6378) — one shared key let a desktop
 * `false` open the pane over the whole phone screen. The wide side keeps the original key.
 */
export const configPanelCollapsedPhonePreferenceAtom = atomWithStorage<boolean | null>(
    "agenta:chat:config-panel-collapsed-phone",
    null,
    undefined,
    {getOnInit: true},
)

/**
 * The default when nothing is stored: hidden on a phone, visible everywhere else — and hidden
 * anywhere a surface asks for it via `hostCollapsed` (first run, which leads with the question
 * rather than a form for an agent that does not exist yet).
 *
 * A stored preference always wins, in both directions. Collapsing the pane on a phone is one tap
 * on the `»` reveal button in the chat header, and that tap stores `false`, so neither the phone
 * default nor a host's default ever fights a user who wants the config pane.
 */
export const resolveConfigPanelCollapsed = (
    stored: boolean | null,
    phoneViewport: boolean,
    hostCollapsed = false,
): boolean => stored ?? (phoneViewport || hostCollapsed)

/** The stored preference for the CURRENT viewport; reading either atom directly picks the
 * wrong breakpoint's answer. */
export const configPanelCollapsedViewportPreferenceAtom = atom((get) =>
    get(
        get(phoneViewportAtom)
            ? configPanelCollapsedPhonePreferenceAtom
            : configPanelCollapsedPreferenceAtom,
    ),
)

/** Build mode's config pane collapsed to 0, separate from the maximize flag. Reads and writes
 * the current viewport's preference so neither breakpoint overwrites the other (#6378). */
export const configPanelCollapsedAtom = atom(
    (get) => {
        const phoneViewport = get(phoneViewportAtom)
        return resolveConfigPanelCollapsed(
            get(
                phoneViewport
                    ? configPanelCollapsedPhonePreferenceAtom
                    : configPanelCollapsedPreferenceAtom,
            ),
            phoneViewport,
        )
    },
    (get, set, collapsed: boolean) => {
        set(
            get(phoneViewportAtom)
                ? configPanelCollapsedPhonePreferenceAtom
                : configPanelCollapsedPreferenceAtom,
            collapsed,
        )
    },
)

/**
 * "Show me the configuration": clears BOTH things that hide the pane — the maximize flag and
 * the collapse preference — since either one alone leaves nothing to edit (#6381).
 */
export const revealConfigPaneAtom = atom(null, (_get, set) => {
    set(chatPanelMaximizedAtom, false)
    set(configPanelCollapsedAtom, false)
})
