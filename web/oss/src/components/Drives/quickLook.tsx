/**
 * The file to preview in the chat Files drawer: a drive-root-relative path OR a tool-path tail.
 * Every opener (grid tiles, in-thread file cards, the context rail, chat file links) just sets
 * this; the {@link FilesDrawer} host (mounted once per conversation, which knows the active
 * session) resolves it against the drive and shows the preview — opening the drawer if needed.
 *
 * Keyed by SESSION ID: antd Tabs keeps every session pane (and its FilesDrawer host) mounted at
 * once, so a single slot would leak a preview into every pane — switch tabs and the new session's
 * host reads the other session's path and shows a broken "not in this drive" preview. Per-session
 * keeps each conversation's preview to itself.
 */
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export const driveQuickLookAtomFamily = atomFamily((_sessionId: string) =>
    atom<{path: string} | null>(null),
)
