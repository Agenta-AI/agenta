import type {SessionStream} from "@agenta/entities/session"
import {sessionMenuAccess} from "@agenta/sessions-ui"
import {atom} from "jotai"

/** What the session bar has open. One value, so opening one panel closes the others. */
export type SessionBarPanel = "switcher" | "more" | "share" | "publish"

export const sessionBarPanelAtom = atom<SessionBarPanel | null>(null)

/** Bumped to put the on-screen session's name into edit: `Alt+R` and the ⋯ menu raise it. */
export const sessionRenameRequestAtom = atom(0)

/** The session menus' rule: its owner renames it, and an archived one keeps its name. */
export const canRenameSession = (stream: SessionStream | null, userId?: string | null): boolean =>
    stream !== null &&
    !stream.archived_at &&
    sessionMenuAccess({ownerUserId: stream.owner_user_id ?? null}, userId) !== "member"
