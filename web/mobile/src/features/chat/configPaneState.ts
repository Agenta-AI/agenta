import {phoneViewportAtom, resolveConfigPanelCollapsed} from "@agenta/chat/state"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * Whether this app's config pane is collapsed, on a key of its own.
 *
 * The shared `configPanelCollapsedAtom` keeps one origin-wide boolean, and the desktop playground
 * writes false to it from several controls: the « collapse control, the onboarding provider setup,
 * the variant config header. On a phone the pane does not sit BESIDE the conversation, it REPLACES
 * it, so that same false hid the whole chat column, composer and all. The way in was using the
 * playground in the same browser; nothing on /m had to be touched at all.
 *
 * The same resolution rule and the same per-device default, under a different key. This is the
 * second defect of its kind on this surface, after the maximized flag `resolveSessionPanes`
 * documents, and both are one shape: a desktop layout preference deciding what a phone shows. Do
 * not point this back at the shared key.
 */
export const mobileConfigPanelCollapsedPreferenceAtom = atomWithStorage<boolean | null>(
    "agenta:m:chat:config-panel-collapsed",
    null,
    undefined,
    {getOnInit: true},
)

export const mobileConfigPanelCollapsedAtom = atom(
    (get) =>
        resolveConfigPanelCollapsed(
            get(mobileConfigPanelCollapsedPreferenceAtom),
            get(phoneViewportAtom),
        ),
    (_get, set, collapsed: boolean) => {
        set(mobileConfigPanelCollapsedPreferenceAtom, collapsed)
    },
)
