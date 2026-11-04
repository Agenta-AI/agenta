import {atom} from "jotai"

/** What the session bar has open. One value, so opening one panel closes the others. */
export type SessionBarPanel = "switcher" | "more" | "share" | "publish"

export const sessionBarPanelAtom = atom<SessionBarPanel | null>(null)

/** Bumped to put the on-screen session's name into edit: `Alt+R` and the ⋯ menu raise it. */
export const sessionRenameRequestAtom = atom(0)
