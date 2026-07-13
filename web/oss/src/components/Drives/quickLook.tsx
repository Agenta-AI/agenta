/**
 * The file to preview in the chat Files drawer: a drive-root-relative path OR a tool-path tail.
 * Every opener (grid tiles, in-thread file cards, the context rail, chat file links) just sets
 * this; the {@link FilesDrawer} host (mounted once per conversation, which knows the active
 * session) resolves it against the drive and shows the preview — opening the drawer if needed.
 */
import {atom} from "jotai"

export const driveQuickLookAtom = atom<{path: string} | null>(null)
